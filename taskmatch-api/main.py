import os
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client
from collections import defaultdict
from datetime import date, datetime, timezone

try:
    from dotenv import load_dotenv  # local dev: read taskmatch-api/.env (Render injects env vars directly)
    load_dotenv()
except Exception:
    pass

app = FastAPI()

# CORS_ORIGINS = comma-separated allowed origins (set to your deployed frontend URL).
# Defaults to "*" so the deployed frontend can reach the API during testing.
_origins = os.environ.get("CORS_ORIGINS", "*")
allow_origins = ["*"] if _origins.strip() == "*" else [o.strip() for o in _origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supabase creds come from env when deployed, with a local fallback so it still runs as-is.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://mcbmgpiaqprrgssuwwys.supabase.co")
supabase = create_client(
    SUPABASE_URL,
    os.environ.get("SUPABASE_KEY", "sb_publishable_7HmS0w3Iy1sP5iViaO2NIg_lTCw2DjZ"),
)

# Admin client uses the secret/service-role key for privileged auth operations
# (listing accounts, changing roles). It is None until the key is configured, so those
# endpoints fail loudly with a 503 rather than silently misbehaving. NEVER expose this key
# to the browser — it bypasses row-level security.
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) if SUPABASE_SERVICE_ROLE_KEY else None


# ─── Auth helpers — only the admin endpoints below are gated ───

def _bearer(authorization):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def require_user(authorization):
    """Verify the caller's Supabase access token and return the auth user."""
    token = _bearer(authorization)
    try:
        res = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if not res or not res.user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return res.user


def require_leader(authorization):
    """Caller must be an authenticated leader. Hiding a button in the UI is not security —
    this server-side check is the real gate for privileged actions."""
    user = require_user(authorization)
    role = (user.user_metadata or {}).get("role", "student")
    if role != "leader":
        raise HTTPException(status_code=403, detail="Leader access required")
    return user


def require_admin_client():
    if admin is None:
        raise HTTPException(
            status_code=503,
            detail="Admin key not configured on the server (set SUPABASE_SERVICE_ROLE_KEY).",
        )
    return admin


WIP_LIMIT = 3


@app.get("/health")
def health():
    """Cheap, DB-free liveness check. The frontend pings this on load to wake the
    free-tier server before the user acts (avoids the cold-start error where a write
    lands but the proxy times out the response)."""
    return {"ok": True}

# Performance-score bands (higher = better; score in 0..1)
def score_band(avg_score, completed_count):
    """Map an average score to a band. Unrated students (no completed
    scored tasks) are treated as 'learner' so they get growth pairings."""
    if not completed_count or avg_score is None:
        return "unrated"
    if avg_score >= 0.6:
        return "high"
    if avg_score >= 0.4:
        return "avg"
    return "low"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


SLA_GRACE_DAYS = 7  # an unfinished task auto-closes (locks) this many days past its due date

def is_task_closed(due_date, status):
    """A task is 'closed' (SLA expired, locked) when it's still not completed and
    overdue by more than the grace window."""
    if status == "Completed" or not due_date:
        return False
    try:
        due = datetime.fromisoformat(due_date).date()
    except Exception:
        return False
    return (datetime.now(timezone.utc).date() - due).days > SLA_GRACE_DAYS


def log_activity(action, entity_type, entity_id=None, summary=None,
                 actor_email=None, actor_role=None, details=None):
    """Append one immutable row to activity_logs. Best-effort: never
    block the main operation if logging fails."""
    try:
        supabase.table("activity_logs").insert({
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "summary": summary,
            "actor_email": actor_email,
            "actor_role": actor_role,
            "details": details,
        }).execute()
    except Exception:
        pass


def compute_student_stats():
    """Return {student_id: {avg_score, completed_count, band}} for all students.
    avg_score is the mean of completed, scored assignments (None if unrated)."""
    assignments = (
        supabase.table("assignments")
        .select("student_id, score, status")
        .execute()
    ).data

    scores_by_student = defaultdict(list)
    for a in assignments:
        if a["status"] == "Completed" and a.get("score") is not None:
            scores_by_student[a["student_id"]].append(a["score"])

    students = (supabase.table("students").select("id").execute()).data
    stats = {}
    for s in students:
        scores = scores_by_student.get(s["id"], [])
        cnt = len(scores)
        avg = round(sum(scores) / cnt, 3) if cnt else None
        stats[s["id"]] = {"avg_score": avg, "completed_count": cnt, "band": score_band(avg, cnt)}
    return stats


# ─── Core matching algorithm ───────────────────────────────────

@app.get("/recommend/{task_id}")
def recommend(task_id: str):

    # Step 1: Get all required skills for this task
    task_skills = (
        supabase.table("task_skills")
        .select("skill_id, min_proficiency")
        .eq("task_id", task_id)
        .execute()
    ).data

    if not task_skills:
        raise HTTPException(status_code=404, detail="Task not found or has no skill requirements")

    required = {ts["skill_id"]: ts["min_proficiency"] for ts in task_skills}

    # Step 2: Get all student skills
    all_student_skills = (
        supabase.table("student_skills")
        .select("student_id, skill_id, proficiency")
        .execute()
    ).data

    # Step 3: Group skills by student
    student_skill_map = defaultdict(dict)
    for row in all_student_skills:
        student_skill_map[row["student_id"]][row["skill_id"]] = row["proficiency"]

    # Step 4: Get each student's current active WIP count
    active_assignments = (
        supabase.table("assignments")
        .select("student_id")
        .in_("status", ["Assigned", "In Progress"])
        .execute()
    ).data

    wip_count = defaultdict(int)
    for row in active_assignments:
        wip_count[row["student_id"]] += 1

    # Names of required skills (for human-readable justifications).
    skill_rows = (
        supabase.table("skills").select("id, skill_name")
        .in_("id", list(required.keys())).execute()
    ).data
    skill_names = {r["id"]: r["skill_name"] for r in skill_rows}

    # Performance stats feed the band + the balanced pairing.
    stats = compute_student_stats()

    # Step 5: Score EVERY student (flag, don't filter) so the leader sees all —
    #         qualified float to the top, the rest are ranked below with a reason.
    all_students = (
        supabase.table("students")
        .select("id, name, matric, programme")
        .execute()
    ).data

    total_required = len(required)
    candidates = []
    for student in all_students:
        student_id = student["id"]
        skills = student_skill_map.get(student_id, {})
        over_wip = wip_count[student_id] >= WIP_LIMIT

        proficiency_scores = []
        met_count = 0
        missing = []
        for skill_id, min_prof in required.items():
            student_prof = skills.get(skill_id, 0)
            proficiency_scores.append(student_prof)
            if student_prof >= min_prof:
                met_count += 1
            else:
                missing.append(skill_names.get(skill_id, "a required skill"))

        meets_skills = met_count == total_required
        avg = sum(proficiency_scores) / len(proficiency_scores) if proficiency_scores else 0

        st = stats.get(student_id, {"avg_score": None, "completed_count": 0, "band": "unrated"})
        band = st["band"]
        unrated = band == "unrated"

        # Why this student appears — fit and/or growth reason.
        if over_wip:
            justification = "At WIP limit — finish current tasks first"
        elif meets_skills and band == "high":
            justification = "Strong fit — meets all required skills, high performer"
        elif meets_skills and band == "avg":
            justification = "Good fit — meets all required skills"
        elif meets_skills and unrated:
            justification = "Meets all required skills — growth opportunity to build a track record"
        elif meets_skills:  # low band
            justification = "Meets all required skills — pairing with a strong member helps them improve"
        else:
            grow = f" to build {missing[0]}" if missing else ""
            justification = (f"Suggested for growth — meets {met_count}/{total_required} required skills; "
                             f"a chance{grow} alongside a strong member")

        candidates.append({
            "student_id":  student_id,
            "name":        student.get("name"),
            "matric":      student.get("matric"),
            "programme":   student.get("programme"),
            "match_score": round(avg, 2),
            "met_count":   met_count,
            "total_required": total_required,
            "wip":         wip_count[student_id],
            "qualified":   meets_skills and not over_wip,
            "over_wip":    over_wip,
            "avg_score":   st["avg_score"],
            "band":        band,
            "unrated":     unrated,
            "justification": justification,
        })

    # Step 6: Qualified first, then skill-match desc, then less busy first.
    candidates.sort(key=lambda x: (not x["qualified"], -x["match_score"], x["wip"]))

    # Step 7: Balanced-pair suggestion — a strong performer + a learner, so the
    #         workload isn't dumped on top performers (per the FYP balance goal).
    def avg_or(c, default):
        return c["avg_score"] if c["avg_score"] is not None else default

    qualified = [c for c in candidates if c["qualified"]]
    strong = learner = None
    if qualified:
        strong = sorted(qualified, key=lambda c: (-(avg_or(c, -1)), -c["match_score"]))[0]
        rest = [c for c in qualified if c["student_id"] != strong["student_id"]]
        pool = rest if rest else [c for c in candidates if c["student_id"] != strong["student_id"]]
        if pool:
            learner = sorted(pool, key=lambda c: (avg_or(c, 0), -c["match_score"]))[0]

    suggested_pair = None
    if strong and learner and strong["student_id"] != learner["student_id"]:
        suggested_pair = {
            "strong":  {"student_id": strong["student_id"], "name": strong["name"],
                        "band": strong["band"], "avg_score": strong["avg_score"]},
            "learner": {"student_id": learner["student_id"], "name": learner["name"],
                        "band": learner["band"], "avg_score": learner["avg_score"]},
            "reason": (f"Balance the workload: pair {strong['name']} (strong) with "
                       f"{learner['name']} ({'unrated' if learner['unrated'] else learner['band']}) "
                       f"so learning is shared, not all work on the top performer."),
        }

    # Min-2 helper: how many people are on this task (assigned or in progress).
    current = (
        supabase.table("assignments").select("id")
        .eq("task_id", task_id).in_("status", ["Assigned", "In Progress"]).execute()
    ).data

    return {
        "task_id": task_id,
        "recommendations": candidates,
        "suggested_pair": suggested_pair,
        "assigned_count": len(current),
        "min_team_size": 2,
        "wip_limit": WIP_LIMIT,
    }

def _create_assignment(task_id, student_id, actor_email, actor_role, self_assigned=False):
    """Shared assignment logic used by both leader-assign and student self-assign.
    Enforces: closed-task lock, one-assignment-per-(task,student), and the WIP limit."""
    if not task_id or not student_id:
        raise HTTPException(status_code=400, detail="task_id and student_id required")

    # A closed task (SLA window expired) is locked — no more assigning.
    tcheck = supabase.table("tasks").select("status, due_date").eq("id", task_id).execute().data
    if tcheck and is_task_closed(tcheck[0].get("due_date"), tcheck[0].get("status")):
        raise HTTPException(status_code=400, detail="This task is closed (SLA window expired) and can no longer be assigned.")

    # Guard against duplicate assignment (e.g. a double-click) — one assignment per (task, student).
    existing = (
        supabase.table("assignments")
        .select("id").eq("task_id", task_id).eq("student_id", student_id).execute()
    ).data
    if existing:
        raise HTTPException(status_code=409,
                            detail="You're already on this task." if self_assigned else "This student is already assigned to this task.")

    # WIP = everything on their plate that isn't done (assigned OR in progress).
    active = (
        supabase.table("assignments")
        .select("id").eq("student_id", student_id).in_("status", ["Assigned", "In Progress"]).execute()
    ).data
    if len(active) >= WIP_LIMIT:
        raise HTTPException(status_code=400,
                            detail=(f"You've reached your workload limit of {WIP_LIMIT} active tasks — finish one before taking another."
                                    if self_assigned else "Student has reached WIP limit"))

    # Create the assignment in the 'Assigned' state — the clock does NOT run yet.
    # The assignee starts it themselves (/start), which is when timing begins.
    try:
        result = (
            supabase.table("assignments")
            .insert({"task_id": task_id, "student_id": student_id,
                     "assigned_date": str(date.today()), "status": "Assigned"})
            .execute()
        ).data
    except Exception as e:
        if "duplicate" in str(e).lower() or "23505" in str(e):
            raise HTTPException(status_code=409, detail="You're already on this task." if self_assigned else "This student is already assigned to this task.")
        raise
    # Task stays 'New' until an assignee actually starts work.

    # Look up names for a readable audit line.
    student = (supabase.table("students").select("name").eq("id", student_id).execute()).data
    task = (supabase.table("tasks").select("description").eq("id", task_id).execute()).data
    student_name = student[0]["name"] if student else student_id
    task_desc = task[0]["description"] if task else task_id

    log_activity(
        action="assignment.self_assigned" if self_assigned else "assignment.assigned",
        entity_type="assignment",
        entity_id=result[0]["id"] if result else None,
        summary=f"{student_name} {'picked up' if self_assigned else 'assigned to'} task '{task_desc}'",
        actor_email=actor_email, actor_role=actor_role,
        details={"task_id": task_id, "student_id": student_id, "self_assigned": self_assigned},
    )
    return {"success": True, "assignment": result}


@app.post("/assign")
def assign(body: dict):
    """Leader assigns a student to a task."""
    return _create_assignment(body.get("task_id"), body.get("student_id"),
                              body.get("actor_email"), body.get("actor_role"))


@app.post("/self-assign")
def self_assign(body: dict, authorization: str = Header(None)):
    """A student picks up a task for themselves. The student is resolved from the caller's
    own verified login token — never from the request body — so this can only ever assign
    the caller to their own account, never anyone else."""
    user = require_user(authorization)
    role = (user.user_metadata or {}).get("role", "student")
    task_id = body.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id required")

    srows = supabase.table("students").select("id, name").eq("email", user.email).execute().data
    if not srows:
        raise HTTPException(status_code=400,
                            detail="No student record is linked to your account. Ask your leader to add you on the Students page.")
    return _create_assignment(task_id, srows[0]["id"], actor_email=user.email, actor_role=role, self_assigned=True)


@app.post("/start")
def start(body: dict):
    """Assignee starts their assigned task — the timer begins now (in_progress_at)."""
    assignment_id = body.get("assignment_id")
    actor_email = body.get("actor_email")
    actor_role = body.get("actor_role")
    if not assignment_id:
        raise HTTPException(status_code=400, detail="assignment_id required")

    rows = (
        supabase.table("assignments")
        .select("id, task_id, student_id, status, in_progress_at")
        .eq("id", assignment_id)
        .execute()
    ).data
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment not found")
    a = rows[0]
    if a["status"] == "Completed":
        raise HTTPException(status_code=400, detail="This task is already completed.")

    started_at = a.get("in_progress_at") or now_iso()
    supabase.table("assignments").update({
        "status": "In Progress",
        "in_progress_at": started_at,
    }).eq("id", assignment_id).execute()

    # First person to start moves the task itself into progress.
    task = (supabase.table("tasks").select("description, status").eq("id", a["task_id"]).execute()).data
    if task and task[0].get("status") == "New":
        supabase.table("tasks").update({"status": "In Progress"}).eq("id", a["task_id"]).execute()

    student = (supabase.table("students").select("name").eq("id", a["student_id"]).execute()).data
    log_activity(
        action="assignment.started", entity_type="assignment", entity_id=assignment_id,
        summary=f"{student[0]['name'] if student else a['student_id']} started task '{task[0]['description'] if task else a['task_id']}'",
        actor_email=actor_email, actor_role=actor_role,
        details={"task_id": a["task_id"], "started_at": started_at},
    )
    return {"success": True, "in_progress_at": started_at}


@app.post("/unassign")
def unassign(body: dict):
    """Remove a student from a task (undo an assignment). Completed assignments are kept —
    they hold the student's performance record. If removing the last active assignee leaves
    the task with no one working it, roll the task back to 'New'."""
    assignment_id = body.get("assignment_id")
    actor_email = body.get("actor_email")
    actor_role = body.get("actor_role")
    if not assignment_id:
        raise HTTPException(status_code=400, detail="assignment_id required")

    rows = (
        supabase.table("assignments")
        .select("id, task_id, student_id, status")
        .eq("id", assignment_id)
        .execute()
    ).data
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment not found")
    a = rows[0]
    if a["status"] == "Completed":
        raise HTTPException(status_code=400,
                            detail="Can't remove a completed assignment — it holds the student's performance record.")

    # Names first (for a readable audit line), then delete.
    student = (supabase.table("students").select("name").eq("id", a["student_id"]).execute()).data
    task = (supabase.table("tasks").select("description, status").eq("id", a["task_id"]).execute()).data
    supabase.table("assignments").delete().eq("id", assignment_id).execute()

    # If nobody is actively on the task anymore, send it back to 'New'.
    remaining = (
        supabase.table("assignments").select("status").eq("task_id", a["task_id"]).execute()
    ).data
    any_active = any(r["status"] in ("Assigned", "In Progress") for r in remaining)
    if task and task[0].get("status") == "In Progress" and not any_active:
        supabase.table("tasks").update({"status": "New"}).eq("id", a["task_id"]).execute()

    log_activity(
        action="assignment.removed", entity_type="assignment", entity_id=assignment_id,
        summary=f"{student[0]['name'] if student else a['student_id']} removed from task "
                f"'{task[0]['description'] if task else a['task_id']}'",
        actor_email=actor_email, actor_role=actor_role,
        details={"task_id": a["task_id"], "student_id": a["student_id"], "prev_status": a["status"]},
    )
    return {"success": True, "task_reverted": bool(task and task[0].get("status") == "In Progress" and not any_active)}


@app.post("/complete")
def complete(body: dict):
    """Mark a student's assignment complete, compute their performance score,
    and flip the task to Completed once every assignee is done.

    score = committed_hours / (committed_hours + elapsed_hours), clamped 0..1.
    Elapsed defaults to wall-clock (in_progress_at -> now), but a manually
    entered actual_hours overrides it.
    """
    assignment_id = body.get("assignment_id")
    actual_hours = body.get("actual_hours")  # optional manual override
    actor_email = body.get("actor_email")
    actor_role = body.get("actor_role")

    if not assignment_id:
        raise HTTPException(status_code=400, detail="assignment_id required")

    rows = (
        supabase.table("assignments")
        .select("id, task_id, student_id, in_progress_at")
        .eq("id", assignment_id)
        .execute()
    ).data
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assignment = rows[0]
    task_id = assignment["task_id"]

    completed_at = datetime.now(timezone.utc)

    # timed_hours = the real timer (start -> now); recorded whenever the task was started.
    started = assignment.get("in_progress_at")
    timed_hours = None
    if started:
        start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
        timed_hours = round(max((completed_at - start_dt).total_seconds() / 3600.0, 0.0), 3)

    # elapsed_hours = the SELF-DECLARED value (drives the score): manual if given, else the timer.
    if actual_hours is not None:
        try:
            elapsed_hours = float(actual_hours)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="actual_hours must be a number")
    elif timed_hours is not None:
        elapsed_hours = timed_hours
    else:
        # Not started and no manual hours given — can't time it.
        raise HTTPException(status_code=400, detail="Start the task first, or enter the hours spent.")

    # committed_hours from the task drives the score; due_date tells us if it's late.
    task = (
        supabase.table("tasks")
        .select("description, committed_hours, due_date, status")
        .eq("id", task_id)
        .execute()
    ).data
    committed = task[0].get("committed_hours") if task else None
    due_date = task[0].get("due_date") if task else None

    # A closed task is locked — it can no longer be completed.
    if task and is_task_closed(due_date, task[0].get("status")):
        raise HTTPException(status_code=400, detail="This task is closed (SLA window expired) and is locked.")

    score = None
    if committed:
        denom = committed + elapsed_hours
        score = round(committed / denom, 3) if denom > 0 else None
        if score is not None:
            score = max(0.0, min(1.0, score))

    supabase.table("assignments").update({
        "status": "Completed",
        "completed_at": completed_at.isoformat(),
        "actual_hours": elapsed_hours,   # self-declared (or timer if none given) — drives score
        "timed_hours": timed_hours,      # the real timer value — for leaders to compare
        "score": score,
    }).eq("id", assignment_id).execute()

    # If every assignment on the task is now Completed, complete the task.
    siblings = (
        supabase.table("assignments")
        .select("status")
        .eq("task_id", task_id)
        .execute()
    ).data
    all_done = siblings and all(s["status"] == "Completed" for s in siblings)
    # Was this completion past the deadline? (overdue = breached the set date, even if finished)
    late = bool(due_date and completed_at.date().isoformat() > due_date)
    if all_done:
        supabase.table("tasks").update({
            "status": "Completed",
            "completed_at": completed_at.isoformat(),
        }).eq("id", task_id).execute()

    student = (supabase.table("students").select("name").eq("id", assignment["student_id"]).execute()).data
    student_name = student[0]["name"] if student else assignment["student_id"]
    task_desc = task[0]["description"] if task else task_id

    # Don't dress up a late finish — flag the deadline breach in the log.
    late_note = f" — ⚠ DELAYED, past due {due_date}" if (all_done and late) else (" — on time" if all_done else "")
    log_activity(
        action="task.completed_late" if (all_done and late) else ("task.completed" if all_done else "assignment.completed"),
        entity_type="assignment",
        entity_id=assignment_id,
        summary=(f"{student_name} completed task '{task_desc}' "
                 f"in {round(elapsed_hours, 2)}h (score {score}){late_note}"),
        actor_email=actor_email, actor_role=actor_role,
        details={"task_id": task_id, "elapsed_hours": elapsed_hours,
                 "committed_hours": committed, "score": score,
                 "task_completed": bool(all_done), "late": late, "due_date": due_date},
    )

    return {"success": True, "score": score, "elapsed_hours": round(elapsed_hours, 2),
            "committed_hours": committed, "late": late, "task_completed": bool(all_done)}


@app.get("/student-stats")
def student_stats():
    """Per-student performance summary: average score over completed, scored
    assignments, plus a band (high/avg/low/unrated) used for matching + display."""
    stats = compute_student_stats()
    students = (supabase.table("students").select("id, name").execute()).data
    out = []
    for s in students:
        st = stats.get(s["id"], {"avg_score": None, "completed_count": 0, "band": "unrated"})
        out.append({"student_id": s["id"], "name": s["name"], **st})
    return {"stats": out}


@app.get("/wip")
def wip_status():
    """Per-student work-in-progress load: how many active (Assigned or In Progress)
    assignments each student holds, against the shared WIP limit. Same definition the
    matcher and /assign use, so the badges everywhere agree. Powers the WIP badges on the
    Students page, the task-assignment view, and the dashboard WIP panel."""
    active = (
        supabase.table("assignments")
        .select("student_id, task_id, status, tasks(description)")
        .in_("status", ["Assigned", "In Progress"])
        .execute()
    ).data

    by_student = defaultdict(list)
    for a in active:
        by_student[a["student_id"]].append({
            "task_id": a["task_id"],
            "status": a["status"],
            "description": (a.get("tasks") or {}).get("description"),
        })

    students = (supabase.table("students").select("id, name").execute()).data
    out = []
    for s in students:
        tasks = by_student.get(s["id"], [])
        wip = len(tasks)
        out.append({
            "student_id": s["id"],
            "name": s["name"],
            "wip": wip,
            "over_wip": wip >= WIP_LIMIT,
            "remaining": max(0, WIP_LIMIT - wip),
            "active_tasks": tasks,
        })
    out.sort(key=lambda x: (-x["wip"], x["name"] or ""))
    at_limit = sum(1 for x in out if x["wip"] >= WIP_LIMIT)
    working = sum(1 for x in out if x["wip"] > 0)
    return {"wip_limit": WIP_LIMIT, "at_limit": at_limit, "working": working, "students": out}


# ─── Reverse matching: recommend tasks for a student ───────────

@app.get("/recommend-tasks/{student_id}")
def recommend_tasks(student_id: str):
    """Given a student, return open tasks whose skill requirements they meet.

    Mirror of /recommend but from the student's perspective — used by the
    student profile page to show 'tasks recommended for you'.
    """

    # Step 1: This student's skill profile
    student_skills = (
        supabase.table("student_skills")
        .select("skill_id, proficiency")
        .eq("student_id", student_id)
        .execute()
    ).data

    skills = {s["skill_id"]: s["proficiency"] for s in student_skills}

    # Step 2: Tasks already linked to this student (any status) -> exclude
    my_assignments = (
        supabase.table("assignments")
        .select("task_id")
        .eq("student_id", student_id)
        .execute()
    ).data
    assigned_task_ids = {a["task_id"] for a in my_assignments}

    # Step 3: Tasks open for assignment or still gathering a team.
    open_tasks = (
        supabase.table("tasks")
        .select("id, description, estimated_days, committed_hours, severity, status")
        .in_("status", ["New", "In Progress"])
        .execute()
    ).data

    candidate_ids = [t["id"] for t in open_tasks if t["id"] not in assigned_task_ids]
    if not candidate_ids:
        return {"student_id": student_id, "qualified": [], "growth": []}

    # Step 4: Required skills for those tasks (+ names for justifications)
    task_skill_rows = (
        supabase.table("task_skills")
        .select("task_id, skill_id, min_proficiency")
        .in_("task_id", candidate_ids)
        .execute()
    ).data

    required_by_task = defaultdict(dict)
    all_skill_ids = set()
    for row in task_skill_rows:
        required_by_task[row["task_id"]][row["skill_id"]] = row["min_proficiency"]
        all_skill_ids.add(row["skill_id"])

    skill_rows = (
        supabase.table("skills").select("id, skill_name")
        .in_("id", list(all_skill_ids)).execute()
    ).data if all_skill_ids else []
    skill_names = {r["id"]: r["skill_name"] for r in skill_rows}

    task_lookup = {t["id"]: t for t in open_tasks}

    # Step 5: Split into 'qualified' (meets all) and 'growth' (partial match).
    qualified_list = []
    growth_list = []
    for task_id, required in required_by_task.items():
        total = len(required)
        met = 0
        missing = []
        proficiency_scores = []
        for skill_id, min_prof in required.items():
            prof = skills.get(skill_id, 0)
            proficiency_scores.append(prof)
            if prof >= min_prof:
                met += 1
            else:
                missing.append(skill_names.get(skill_id, "a required skill"))

        task = task_lookup[task_id]
        base = {
            "task_id": task_id,
            "description": task["description"],
            "estimated_days": task.get("estimated_days"),
            "committed_hours": task.get("committed_hours"),
            "severity": task.get("severity"),
            "status": task.get("status"),
            "match_score": round(sum(proficiency_scores) / len(proficiency_scores), 2) if proficiency_scores else 0,
            "met_count": met,
            "total_required": total,
        }
        if met == total:
            base["reason"] = "You meet the required skills"
            qualified_list.append(base)
        elif met >= 1:
            grow = f" to build {missing[0]}" if missing else ""
            base["reason"] = f"Growth opportunity{grow} — you meet {met}/{total} required skills"
            growth_list.append(base)
        # met == 0 -> not relevant enough to suggest

    qualified_list.sort(key=lambda x: -x["match_score"])
    growth_list.sort(key=lambda x: -x["match_score"])

    return {"student_id": student_id, "qualified": qualified_list, "growth": growth_list}


# ─── Admin: accounts & roles (leader-gated, service-role) ──────

def _list_all_users(admin_client):
    """Walk every page of auth users (list_users caps at 50/page by default)."""
    users, page = [], 1
    while True:
        batch = admin_client.auth.admin.list_users(page=page, per_page=200)
        if not batch:
            break
        users.extend(batch)
        if len(batch) < 200:
            break
        page += 1
    return users


def _account_view(user, roster_emails):
    """Trim a Supabase auth user down to what the UI needs."""
    meta = user.user_metadata or {}
    email = user.email or ""
    return {
        "id": user.id,
        "email": email,
        "name": meta.get("full_name") or meta.get("name"),
        "role": meta.get("role", "student"),
        "on_roster": email.lower() in roster_emails,
        "created_at": str(user.created_at) if user.created_at else None,
    }


@app.get("/accounts")
def list_accounts(authorization: str = Header(None)):
    """List every signup (login) account, flagged with whether it's already on the
    student roster. Lets a leader attach a roster row to an existing account instead of
    retyping an email that may not match anyone. Leader-only."""
    require_leader(authorization)
    admin_client = require_admin_client()

    users = _list_all_users(admin_client)
    roster = supabase.table("students").select("email").execute().data or []
    roster_emails = {(s.get("email") or "").lower() for s in roster if s.get("email")}

    accounts = [_account_view(u, roster_emails) for u in users]
    accounts.sort(key=lambda a: (a["email"] or "").lower())
    return {"accounts": accounts}


@app.post("/set-role")
def set_role(body: dict, authorization: str = Header(None)):
    """Promote/demote an account between 'student' and 'leader'. Leader-only, with a guard
    against demoting the last remaining leader (which would lock everyone out), and every
    change written to the audit log."""
    actor = require_leader(authorization)
    admin_client = require_admin_client()

    user_id = body.get("user_id")
    new_role = body.get("role")
    if new_role not in ("student", "leader"):
        raise HTTPException(status_code=400, detail="role must be 'student' or 'leader'")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")

    target = admin_client.auth.admin.get_user_by_id(user_id)
    tuser = target.user if target else None
    if not tuser:
        raise HTTPException(status_code=404, detail="Account not found")

    meta = dict(tuser.user_metadata or {})
    current_role = meta.get("role", "student")
    if current_role == new_role:
        return {"success": True, "unchanged": True, "role": new_role, "email": tuser.email}

    # Guard: never demote the last leader — that would leave nobody able to manage the project.
    if current_role == "leader" and new_role == "student":
        leaders = [u for u in _list_all_users(admin_client)
                   if (u.user_metadata or {}).get("role") == "leader"]
        if len(leaders) <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last remaining leader.")

    # Merge — update_user_by_id replaces user_metadata wholesale, so keep the rest (e.g. full_name).
    meta["role"] = new_role
    admin_client.auth.admin.update_user_by_id(user_id, {"user_metadata": meta})

    log_activity(
        action="account.role_changed",
        entity_type="account",
        entity_id=user_id,
        summary=f"{tuser.email} role changed: {current_role} → {new_role}",
        actor_email=getattr(actor, "email", None),
        actor_role="leader",
        details={"target_email": tuser.email, "from": current_role, "to": new_role},
    )
    return {"success": True, "role": new_role, "email": tuser.email}
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import { logActivity } from '../lib/log'
import Sidebar from '../components/Sidebar'
import SkillPicker from '../components/SkillPicker'
import { toast, confirmDialog } from '../lib/ui'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PROFICIENCY = ['', 'Beginner', 'Intermediate', 'Advanced']

export default function Profile() {
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string>('')
  const [userRole, setUserRole] = useState<string>('')
  const [student, setStudent] = useState<any>(null)
  const [skills, setSkills] = useState<any[]>([])
  const [mySkills, setMySkills] = useState<{ skill_id: string, proficiency: number }[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [recommended, setRecommended] = useState<{ qualified: any[], growth: any[] }>({ qualified: [], growth: [] })
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserEmail(session.user.email || '')
    setUserRole(session.user.user_metadata?.role || 'student')

    const { data: skillData } = await supabase.from('skills').select('*')
    setSkills(skillData || [])

    // Link the logged-in account to a student record by email
    const { data: studentData } = await supabase
      .from('students')
      .select('*, student_skills(skill_id, proficiency, skills(skill_name))')
      .eq('email', session.user.email)
      .maybeSingle()

    if (!studentData) { setNotFound(true); setLoading(false); return }

    setStudent(studentData)
    setMySkills(
      (studentData.student_skills || []).map((ss: any) => ({
        skill_id: ss.skill_id,
        proficiency: ss.proficiency,
      }))
    )
    await loadTasks(studentData.id)
    setLoading(false)
  }

  const loadTasks = async (studentId: string) => {
    const { data: assignData } = await supabase
      .from('assignments')
      .select('*, tasks(id, description, status, estimated_days, due_date)')
      .eq('student_id', studentId)
      .order('assigned_date', { ascending: false })
    setAssignments(assignData || [])

    try {
      const res = await axios.get(`${API}/recommend-tasks/${studentId}`)
      setRecommended({ qualified: res.data.qualified || [], growth: res.data.growth || [] })
    } catch {
      setRecommended({ qualified: [], growth: [] })
    }
  }

  const completeAssignment = async (assignmentId: string, taskDesc: string) => {
    const input = prompt(
      `Mark "${taskDesc}" complete.\n\nHours you actually spent on it (optional — leave blank to use the tracked elapsed time):`
    )
    if (input === null) return // cancelled
    const trimmed = input.trim()
    const actual_hours = trimmed === '' ? undefined : parseFloat(trimmed)
    if (actual_hours !== undefined && (isNaN(actual_hours) || actual_hours < 0)) {
      toast('Enter a valid number of hours.', 'error')
      return
    }
    try {
      const res = await axios.post(`${API}/complete`, {
        assignment_id: assignmentId,
        actual_hours,
        actor_email: userEmail,
        actor_role: userRole,
      })
      toast(res.data.score != null && res.data.committed_hours != null
        ? `Completed! Score ${res.data.score} (${res.data.committed_hours}h committed vs ${res.data.elapsed_hours}h actual)`
        : `Completed! Your score: ${res.data.score ?? 'n/a'}`, 'success')
      if (student) await loadTasks(student.id)
    } catch (err: any) {
      toast(err.response?.data?.detail || 'Failed to complete', 'error')
    }
  }

  // Bearer header so the API can verify who's picking the task up.
  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session ? { Authorization: `Bearer ${session.access_token}` } : {}
  }

  // Self-assign: the API resolves the student from this token, so it can only ever add
  // the task to the caller's own account.
  const pickTask = async (taskId: string, desc: string) => {
    if (!(await confirmDialog({ title: 'Pick up this task?', message: `"${desc}" will be added to your tasks — start its timer from My Tasks when you begin.`, confirmLabel: 'Pick it up' }))) return
    setPicking(taskId)
    try {
      const headers = await authHeader()
      await axios.post(`${API}/self-assign`, { task_id: taskId }, { headers })
      if (student) await loadTasks(student.id)
      toast(`"${desc}" added to your tasks.`, 'success')
    } catch (err: any) {
      toast(err.response?.data?.detail || 'Could not pick up this task. The server may be waking up — try again.', 'error')
    } finally { setPicking(null) }
  }

  const uploadAvatar = async (file?: File) => {
    if (!file || !student) return
    setSaving(true)
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `${student.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' })
    if (upErr) { setSaving(false); toast(`Upload failed: ${upErr.message}`, 'error'); return }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    await supabase.from('students').update({ avatar_url: pub.publicUrl }).eq('id', student.id)
    await logActivity({
      action: 'student.photo_updated', entity_type: 'student', entity_id: student.id,
      summary: `${student.name} updated their profile photo`,
    })
    const { data: refreshed } = await supabase
      .from('students')
      .select('*, student_skills(skill_id, proficiency, skills(skill_name))')
      .eq('id', student.id).single()
    setStudent(refreshed)
    setSaving(false)
  }


  const saveSkills = async () => {
    if (!student) return
    setSaving(true)
    await supabase.from('student_skills').delete().eq('student_id', student.id)
    if (mySkills.length > 0) {
      await supabase.from('student_skills').insert(
        mySkills.map(s => ({ student_id: student.id, skill_id: s.skill_id, proficiency: s.proficiency }))
      )
    }
    // Refresh student record (and re-run reverse matching, since skills changed)
    const { data: refreshed } = await supabase
      .from('students')
      .select('*, student_skills(skill_id, proficiency, skills(skill_name))')
      .eq('id', student.id)
      .single()
    setStudent(refreshed)
    await logActivity({
      action: 'student.skills_updated', entity_type: 'student', entity_id: student.id,
      summary: `${student.name} updated their own skills (${mySkills.length} skill${mySkills.length === 1 ? '' : 's'})`,
      details: { skills: mySkills, self: true },
    })
    await loadTasks(student.id)
    setEditing(false)
    setSaving(false)
  }

  const initials = (name: string) =>
    name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  const statusColor = (status: string) => {
    if (status === 'New') return 'bg-yellow-500/20 text-yellow-400'
    if (status === 'In Progress') return 'bg-green-500/20 text-green-400'
    if (status === 'Completed') return 'bg-blue-500/20 text-blue-400'
    return 'bg-white/10 text-white/40'
  }

  // WIP = the student's own active assignments (Assigned or In Progress) — same definition the
  // matcher, /assign, /wip and the roster use. (Previously counted the TASK's status, which wrongly
  // included tasks the student had already completed but teammates hadn't.)
  const wip = assignments.filter(a => a.status === 'Assigned' || a.status === 'In Progress').length

  // My stats (computed locally — mirrors the per-student dashboard)
  const myDone = assignments.filter(a => a.status === 'Completed')
  const myActive = assignments.filter(a => a.status === 'In Progress')
  const myScored = myDone.filter(a => a.score != null)
  const myAvg = myScored.length ? (myScored.reduce((s, a) => s + a.score, 0) / myScored.length) : null
  const myBand = myAvg == null ? 'unrated' : myAvg >= 0.6 ? 'high' : myAvg >= 0.4 ? 'avg' : 'low'
  const myTimed = myDone.filter(a => a.actual_hours != null)
  const myAvgTime = myTimed.length ? (myTimed.reduce((s, a) => s + a.actual_hours, 0) / myTimed.length).toFixed(1) : '—'
  const myOnTime = myDone.filter(a => a.completed_at && a.tasks?.due_date && a.completed_at.slice(0, 10) <= a.tasks.due_date).length
  const myLate = myDone.length - myOnTime
  const bandClass = (b: string) => ({ high: 'text-emerald-400', avg: 'text-amber-400', low: 'text-red-400', unrated: 'text-white/50' }[b] || 'text-white/50')

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <h1 className="text-2xl font-semibold text-white mb-6">My Profile</h1>

        {loading ? (
          <p className="text-white/40 text-sm">Loading...</p>
        ) : notFound ? (
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-lg">
            <p className="text-sm text-white mb-1">No student record linked to your account.</p>
            <p className="text-xs text-white/40">
              Your login email (<span className="text-white/70">{userEmail}</span>) doesn&apos;t match any
              student in the roster. Ask your team leader to add you on the Students page using this email,
              then refresh.
            </p>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mb-6">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  {student.avatar_url ? (
                    <img src={student.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xl font-semibold">
                      {initials(student.name)}
                    </div>
                  )}
                  <label title="Change photo"
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 hover:bg-indigo-700 flex items-center justify-center cursor-pointer border-2 border-[#1a1a1a]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3 text-white"><path d="M12 5v14M5 12h14" /></svg>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => uploadAvatar(e.target.files && e.target.files[0] ? e.target.files[0] : undefined)} />
                  </label>
                </div>
                <div className="flex-1">
                  <p className="text-lg font-semibold text-white">{student.name}</p>
                  <p className="text-xs text-white/40">
                    {student.matric} · {student.programme} · Year {student.year}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-white">{wip}<span className="text-sm text-white/40">/3</span></p>
                  <p className="text-xs text-white/40">active tasks (WIP)</p>
                </div>
              </div>
            </div>

            {/* My stats — mini dashboard */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
              {[
                { label: 'Avg score', value: myAvg == null ? '—' : myAvg.toFixed(2), sub: myBand, color: bandClass(myBand) },
                { label: 'Assigned', value: assignments.length, sub: 'total tasks', color: 'text-white' },
                { label: 'Completed', value: myDone.length, sub: 'finished', color: 'text-blue-400' },
                { label: 'Active', value: myActive.length, sub: 'in progress', color: 'text-green-400' },
                { label: 'Avg time', value: myAvgTime === '—' ? '—' : `${myAvgTime}h`, sub: 'per task', color: 'text-white' },
                { label: 'Late', value: myLate, sub: `${myOnTime} on time`, color: myLate > 0 ? 'text-amber-400' : 'text-white/60' },
              ].map(m => (
                <div key={m.label} className="bg-[#1a1a1a] border border-white/10 rounded-xl p-3">
                  <p className="text-[11px] text-white/40 mb-1">{m.label}</p>
                  <p className={`text-xl font-semibold ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] text-white/30 mt-0.5 capitalize">{m.sub}</p>
                </div>
              ))}
            </div>

            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
              <span className="text-white/30 text-xs mt-0.5">ⓘ</span>
              <p className="text-xs text-white/40">
                <span className="text-white/60">How your score works:</span> score = committed hours ÷ (committed + actual hours), between 0 and 1.
                Finishing in less time than budgeted scores higher. Bands: <span className="text-emerald-400">High ≥ 0.6</span> · <span className="text-amber-400">Avg ≥ 0.4</span> · <span className="text-red-400">Low &lt; 0.4</span>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* My skills */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-medium text-white">My skills</p>
                  {!editing ? (
                    <button onClick={() => setEditing(true)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/60 hover:text-white transition">
                      Edit skills
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={saveSkills} disabled={saving}
                        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => {
                        setEditing(false)
                        setMySkills((student.student_skills || []).map((ss: any) => ({ skill_id: ss.skill_id, proficiency: ss.proficiency })))
                      }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white transition">
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {!editing ? (
                  (student.student_skills || []).length === 0 ? (
                    <p className="text-xs text-white/40">No skills declared yet. Click &ldquo;Edit skills&rdquo; to add some.</p>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      {student.student_skills.map((ss: any) => (
                        <span key={ss.skill_id} className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">
                          {ss.skills?.skill_name} · {PROFICIENCY[ss.proficiency]}
                        </span>
                      ))}
                    </div>
                  )
                ) : (
                  <SkillPicker skills={skills} value={mySkills} onChange={setMySkills} />
                )}
              </div>

              {/* My assigned tasks */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
                <p className="text-sm font-medium text-white mb-4">My assigned tasks</p>
                {assignments.length === 0 ? (
                  <p className="text-xs text-white/40">No tasks assigned to you yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {assignments.map(a => (
                      <div key={a.id} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                        <div className="flex-1">
                          <p className="text-sm text-white">{a.tasks?.description || '(task removed)'}</p>
                          <p className="text-xs text-white/40">
                            Assigned {a.assigned_date}
                            {a.completed_at ? ` · Completed ${new Date(a.completed_at).toLocaleDateString()}` : ''}
                            {a.score != null ? ` · Score ${a.score}` : ''}
                          </p>
                        </div>
                        {a.status === 'In Progress' && (
                          <button
                            onClick={() => completeAssignment(a.id, a.tasks?.description || 'this task')}
                            className="text-xs px-3 py-1.5 rounded-lg border border-green-500/30 text-green-400 hover:bg-green-500/10 transition">
                            Complete
                          </button>
                        )}
                        <span className={`text-xs px-2 py-1 rounded-full ${statusColor(a.status)}`}>
                          {a.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recommended tasks for me */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mt-6">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-white">Suggested for you</p>
                {wip >= 3 && <span className="text-[11px] text-amber-400">At workload limit ({wip}/3)</span>}
              </div>
              <p className="text-xs text-white/40 mb-4">Tasks the matcher considered you for — by skill fit or as a growth opportunity. Pick one up to add it to your own list{wip >= 3 ? ', once you finish an active task' : ''}, or your leader can assign you.</p>
              {recommended.qualified.length === 0 && recommended.growth.length === 0 ? (
                <p className="text-xs text-white/40">No suggested tasks right now.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {[...recommended.qualified.map((r: any) => ({ ...r, _group: 'fit' })),
                    ...recommended.growth.map((r: any) => ({ ...r, _group: 'growth' }))].map(r => (
                    <div key={r.task_id} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                      <div className="flex-1">
                        <p className="text-sm text-white flex items-center gap-2 flex-wrap">
                          {r.description}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${r._group === 'fit' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            Suggested{r._group === 'growth' ? ' · growth' : ''}
                          </span>
                        </p>
                        <p className="text-xs text-white/40">{r.reason}</p>
                        <p className="text-xs text-white/30 mt-0.5">
                          {r.committed_hours != null ? `${r.committed_hours}h` : (r.estimated_days ? `~${r.estimated_days}d` : '')}
                          {r.severity ? ` · ${r.severity}` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => pickTask(r.task_id, r.description)}
                        disabled={picking === r.task_id || wip >= 3}
                        title={wip >= 3 ? 'You are at your workload limit (3 active tasks)' : 'Add this task to your own list'}
                        className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition disabled:opacity-30 disabled:hover:bg-transparent shrink-0">
                        {picking === r.task_id ? 'Adding…' : 'Pick this task'}
                      </button>
                      <span className={`text-xs px-2 py-1 rounded-full ${statusColor(r.status)}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

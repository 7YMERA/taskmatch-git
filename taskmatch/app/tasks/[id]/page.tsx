'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import { logActivity } from '../../lib/log'
import Sidebar from '../../components/Sidebar'
import { toast, confirmDialog } from '../../lib/ui'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PROFICIENCY = ['', 'Beginner', 'Intermediate', 'Advanced']

export default function TaskDetail() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('')
  const [task, setTask] = useState<any>(null)
  const [assignees, setAssignees] = useState<any[]>([])
  const [recs, setRecs] = useState<any[]>([])
  const [meta, setMeta] = useState<any>(null)
  const [comments, setComments] = useState<any[]>([])
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email || '')
      setUserRole(session.user.user_metadata?.role || 'student')
    })
    loadAll()
  }, [id])

  const loadAll = async () => {
    const { data: t } = await supabase
      .from('tasks')
      .select('*, task_skills(skill_id, min_proficiency, skills(skill_name))')
      .eq('id', id).single()
    setTask(t)
    await Promise.all([loadAssignees(), loadComments(), loadRecs()])
    setLoading(false)
  }

  const loadAssignees = async () => {
    const { data } = await supabase
      .from('assignments')
      .select('*, students(name, matric)')
      .eq('task_id', id)
    setAssignees(data || [])
  }

  const loadComments = async () => {
    const { data } = await supabase
      .from('task_comments').select('*').eq('task_id', id)
      .order('created_at', { ascending: true })
    setComments(data || [])
  }

  const loadRecs = async () => {
    try {
      const res = await axios.get(`${API}/recommend/${id}`)
      setRecs(res.data.recommendations)
      setMeta({ suggested_pair: res.data.suggested_pair, assigned_count: res.data.assigned_count, wip_limit: res.data.wip_limit ?? 3 })
    } catch { setRecs([]) }
  }

  const refresh = async () => {
    const { data: t } = await supabase.from('tasks')
      .select('*, task_skills(skill_id, min_proficiency, skills(skill_name))').eq('id', id).single()
    setTask(t)
    await Promise.all([loadAssignees(), loadRecs()])
  }

  // Turn an axios error into a message that names the real reason instead of a bare "Failed"
  // (e.g. a closed task, or the free-tier backend still waking up).
  const errMsg = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail
    if (detail) return detail
    if (err?.response) return `${fallback} (server responded ${err.response.status})`
    return `${fallback} — couldn't reach the server. It may be waking up (free tier); try again in a moment.`
  }

  const assignStudent = async (student_id: string, name: string) => {
    if (assigning) return
    setAssigning(student_id)
    try {
      await axios.post(`${API}/assign`, { task_id: id, student_id, actor_email: userEmail, actor_role: userRole })
      await refresh()
      toast(`${name} assigned!`, 'success')
    } catch (err: any) { toast(errMsg(err, 'Could not assign'), 'error') } finally { setAssigning(null) }
  }

  const removeAssignee = async (assignmentId: string, name: string, status: string) => {
    if (status === 'Completed') { toast("This assignment is completed — it's kept as the student's performance record and can't be removed.", 'info'); return }
    if (!(await confirmDialog({ title: `Remove ${name} from this task?`, message: `They keep their profile and history; only this assignment is removed.${status === 'In Progress' ? ' Their running timer for this task will be discarded.' : ''}`, danger: true, confirmLabel: 'Remove' }))) return
    try {
      await axios.post(`${API}/unassign`, { assignment_id: assignmentId, actor_email: userEmail, actor_role: userRole })
      await refresh()
    } catch (err: any) { toast(errMsg(err, 'Could not remove'), 'error') }
  }

  const startAssignment = async (assignmentId: string) => {
    try {
      await axios.post(`${API}/start`, { assignment_id: assignmentId, actor_email: userEmail, actor_role: userRole })
      await refresh()
    } catch (err: any) { toast(errMsg(err, 'Could not start'), 'error') }
  }

  const completeAssignment = async (assignmentId: string, name: string) => {
    const input = prompt(`Mark ${name}'s work complete.\n\nActual hours spent (optional — blank uses tracked elapsed time):`)
    if (input === null) return
    const trimmed = input.trim()
    const actual_hours = trimmed === '' ? undefined : parseFloat(trimmed)
    if (actual_hours !== undefined && (isNaN(actual_hours) || actual_hours < 0)) { toast('Enter a valid number.', 'error'); return }
    try {
      const res = await axios.post(`${API}/complete`, { assignment_id: assignmentId, actual_hours, actor_email: userEmail, actor_role: userRole })
      toast(res.data.score != null && res.data.committed_hours != null
        ? `Completed! Score ${res.data.score} (${res.data.committed_hours}h committed vs ${res.data.elapsed_hours}h actual)`
        : `Completed! Score: ${res.data.score ?? 'n/a'}`, 'success')
      await refresh()
    } catch (err: any) { toast(errMsg(err, 'Could not complete'), 'error') }
  }

  const addComment = async () => {
    const body = newComment.trim()
    if (!body) return
    const { data, error } = await supabase.from('task_comments')
      .insert({ task_id: id, author_email: userEmail, author_role: userRole, body })
      .select().single()
    if (error) return toast(error.message, 'error')
    await logActivity({
      action: 'comment.added', entity_type: 'comment', entity_id: data.id,
      summary: `${userEmail} commented on '${task?.description || 'a task'}'`,
      details: { task_id: id, body },
    })
    setNewComment('')
    loadComments()
  }

  const statusColor = (s: string) =>
    s === 'New' ? 'bg-yellow-500/20 text-yellow-400'
      : s === 'In Progress' ? 'bg-green-500/20 text-green-400'
      : s === 'Completed' ? 'bg-blue-500/20 text-blue-400'
      : 'bg-white/10 text-white/40'

  const severityColor = (s: string) =>
    s === 'Critical' ? 'bg-red-500/20 text-red-400'
      : s === 'Medium' ? 'bg-amber-500/20 text-amber-400'
      : 'bg-white/10 text-white/50'

  const GRACE_DAYS = 7
  const today = new Date().toISOString().slice(0, 10)
  const isClosed = (t: any) => t && t.status !== 'Completed' && t.due_date && Math.floor((Date.parse(today) - Date.parse(t.due_date)) / 86400000) > GRACE_DAYS
  const isDelayed = (t: any) => t && t.status !== 'Completed' && t.due_date && t.due_date < today && !isClosed(t)
  const isLate = (t: any) => t && t.status === 'Completed' && t.completed_at && t.completed_at.slice(0, 10) > t.due_date

  const bandChip = (band: string, avg: number | null) => {
    const map: any = { high: 'bg-emerald-500/20 text-emerald-400', avg: 'bg-amber-500/20 text-amber-400', low: 'bg-red-500/20 text-red-400', unrated: 'bg-white/10 text-white/40' }
    return <span className={`text-xs px-2 py-0.5 rounded-full ${map[band] || map.unrated}`}>{band === 'unrated' ? '— unrated' : `${band} ${avg ?? ''}`.trim()}</span>
  }

  const initials = (n: string) => n?.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()
  const assignedIds = new Set(assignees.map(a => a.student_id))

  // WIP badge: green with room, amber on the last slot, red when at/over the limit.
  const wipLimit = meta?.wip_limit ?? 3
  const wipChip = (wip: number) => {
    const cls = wip >= wipLimit ? 'bg-red-500/20 text-red-400'
      : wip >= wipLimit - 1 ? 'bg-amber-500/20 text-amber-400'
        : 'bg-emerald-500/20 text-emerald-400'
    return <span title={`${wip} active task${wip === 1 ? '' : 's'} out of a limit of ${wipLimit}`}
      className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>WIP {wip}/{wipLimit}</span>
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <Link href="/tasks" className="text-xs text-white/40 hover:text-white">← Back to tasks</Link>

        {loading ? (
          <p className="text-white/40 text-sm mt-6">Loading...</p>
        ) : !task ? (
          <p className="text-white/40 text-sm mt-6">Task not found.</p>
        ) : (
          <>
            {/* Header */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mt-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h1 className="text-xl font-semibold text-white">{task.description}</h1>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    {task.severity && <span className={`text-xs px-2 py-0.5 rounded-full ${severityColor(task.severity)}`}>{task.severity}</span>}
                    <span className={`text-xs px-2 py-1 rounded-full ${statusColor(task.status)}`}>{task.status}</span>
                    {isLate(task) && (
                      <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-400" title={`Delivered after due ${task.due_date}`}>Late</span>
                    )}
                    {isDelayed(task) && (
                      <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400" title={`SLA breached — past due ${task.due_date}`}>Delayed</span>
                    )}
                    {isClosed(task) && (
                      <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/50" title={`Auto-closed — overdue more than ${GRACE_DAYS} days`}>Closed 🔒</span>
                    )}
                    {task.task_skills?.map((ts: any) => (
                      <span key={ts.skill_id} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                        {ts.skills?.skill_name} · {PROFICIENCY[ts.min_proficiency]}+
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right text-xs text-white/40">
                  {task.committed_hours != null && <p>{task.committed_hours}h committed</p>}
                  {(task.start_date || task.due_date) && <p>{task.start_date || '…'} → {task.due_date || '…'}</p>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Assignees */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
                <p className="text-sm font-medium text-white mb-1">Team ({assignees.length})</p>
                {assignees.length < 2 && (
                  <p className="text-xs text-amber-400 mb-3">⚠ Tasks should have at least 2 people.</p>
                )}
                {assignees.length === 0 ? (
                  <p className="text-xs text-white/40">No one assigned yet.</p>
                ) : (
                  <div className="flex flex-col gap-2 mt-2">
                    {assignees.map(a => (
                      <div key={a.id} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold shrink-0">{initials(a.students?.name)}</div>
                        <div className="flex-1">
                          <span className="flex items-center gap-2 flex-wrap">
                            <Link href={`/students/${a.student_id}`} className="text-sm text-white hover:underline">{a.students?.name}</Link>
                            {recs.length > 0 && wipChip(recs.find(r => r.student_id === a.student_id)?.wip ?? 0)}
                          </span>
                          <p className="text-xs text-white/40">
                            {a.status}
                            {a.score != null ? ` · score ${a.score}` : ''}
                            {a.actual_hours != null ? ` · ${Math.round(a.actual_hours * 10) / 10}h declared` : ''}
                            {userRole === 'leader' && a.timed_hours != null ? ` · ⏱ ${Math.round(a.timed_hours * 10) / 10}h timed` : ''}
                          </p>
                        </div>
                        {a.status === 'Assigned' && !isClosed(task) && (
                          <button onClick={() => startAssignment(a.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition">▶ Start</button>
                        )}
                        {a.status === 'In Progress' && !isClosed(task) && (
                          <button onClick={() => completeAssignment(a.id, a.students?.name)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-green-500/30 text-green-400 hover:bg-green-500/10 transition">Complete</button>
                        )}
                        {userRole === 'leader' && a.status !== 'Completed' && (
                          <button onClick={() => removeAssignee(a.id, a.students?.name, a.status)} title="Remove from this task"
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition">Remove</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recommendations */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
                <p className="text-sm font-medium text-white mb-1">Recommended</p>
                {isClosed(task) && (
                  <div className="my-2 rounded-lg border border-white/15 bg-white/5 p-2.5">
                    <p className="text-xs text-white/70">🔒 This task is closed (SLA window expired), so assignments are disabled. This is about the task&apos;s deadline — not any student&apos;s skill level.</p>
                  </div>
                )}
                {meta?.suggested_pair && (
                  <div className="my-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2.5">
                    <p className="text-xs font-medium text-indigo-300 mb-1">⚖️ Suggested balanced pair</p>
                    <p className="text-xs text-white/60">{meta.suggested_pair.reason}</p>
                  </div>
                )}
                <div className="flex flex-col gap-2 mt-2 max-h-96 overflow-y-auto">
                  {recs.filter(r => !assignedIds.has(r.student_id)).map(r => (
                    <div key={r.student_id} className="flex items-center gap-3 bg-white/5 rounded-lg p-2.5">
                      <div className="flex-1">
                        <p className="text-sm text-white flex items-center gap-2 flex-wrap">
                          {r.name}
                          {bandChip(r.band, r.avg_score)}
                          {wipChip(r.wip)}
                          {!r.qualified && !r.over_wip && <span title="Below the required skill level — can still be assigned as a growth pairing" className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">below min</span>}
                        </p>
                        <p className="text-xs text-white/30 italic mt-0.5">{r.justification}</p>
                      </div>
                      {userRole === 'leader' && (
                        <button onClick={() => assignStudent(r.student_id, r.name)} disabled={r.over_wip || isClosed(task) || assigning === r.student_id}
                          className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:hover:bg-transparent">{assigning === r.student_id ? 'Assigning…' : 'Assign'}</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Comments */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mt-6">
              <p className="text-sm font-medium text-white mb-4">Comments ({comments.length})</p>
              <div className="flex flex-col gap-3 mb-4">
                {comments.length === 0 ? (
                  <p className="text-xs text-white/40">No comments yet. Share progress or notes below.</p>
                ) : comments.map(c => (
                  <div key={c.id} className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-white/80">{c.author_email}</span>
                      {c.author_role && <span className="text-xs text-white/30">· {c.author_role}</span>}
                      <span className="text-xs text-white/30 ml-auto">{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-white/80 whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addComment() }}
                  placeholder="Write a comment on progress…"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
                />
                <button onClick={addComment}
                  className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">Post</button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

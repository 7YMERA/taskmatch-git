'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import Sidebar from '../components/Sidebar'
import { toast } from '../lib/ui'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function MyTasks() {
  const router = useRouter()
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('')
  const [student, setStudent] = useState<any>(null)
  const [assignments, setAssignments] = useState<any[]>([])
  const [tab, setTab] = useState<'active' | 'completed'>('active')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const [showTimers, setShowTimers] = useState(true)   // the elapsed-time box can be shown/hidden
  const [teamTasks, setTeamTasks] = useState<any[]>([])

  useEffect(() => { init() }, [])
  // live clock for the running timers
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  // remember the show/hide-timers preference across visits
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('tm_show_timers') : null
    if (saved !== null) setShowTimers(saved === '1')
  }, [])
  const toggleTimers = () => setShowTimers(v => {
    const nv = !v
    try { localStorage.setItem('tm_show_timers', nv ? '1' : '0') } catch { /* private mode */ }
    return nv
  })

  const errMsg = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail
    if (detail) return detail
    if (err?.response) return `${fallback} (server responded ${err.response.status})`
    return `${fallback} — couldn't reach the server. It may be waking up (free tier); try again in a moment.`
  }

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserEmail(session.user.email || '')
    setUserRole(session.user.user_metadata?.role || 'student')
    const { data: s } = await supabase.from('students').select('*').eq('email', session.user.email).maybeSingle()
    if (!s) { setNotFound(true); setLoading(false); return }
    setStudent(s)
    await load(s.id)
    await loadTeam(s.group_label, s.id)
    setLoading(false)
  }

  // Teammates' active tasks + due dates, so a student can schedule around the group.
  const loadTeam = async (grp: string | null, selfId: string) => {
    if (!grp) { setTeamTasks([]); return }
    const { data: mates } = await supabase.from('students').select('id, name').eq('group_label', grp).neq('id', selfId)
    const ids = (mates || []).map(m => m.id)
    if (ids.length === 0) { setTeamTasks([]); return }
    const nameById: { [id: string]: string } = {}
    ;(mates || []).forEach(m => { nameById[m.id] = m.name })
    const { data } = await supabase
      .from('assignments')
      .select('student_id, status, tasks(description, due_date)')
      .in('student_id', ids)
      .in('status', ['Assigned', 'In Progress'])
    const rows = (data || [])
      .filter((a: any) => a.tasks)
      .map((a: any) => ({ name: nameById[a.student_id], description: a.tasks.description, due_date: a.tasks.due_date, status: a.status }))
      .sort((x: any, y: any) => (x.due_date || '9999-12-31').localeCompare(y.due_date || '9999-12-31'))
    setTeamTasks(rows)
  }

  const load = async (sid: string) => {
    const { data } = await supabase
      .from('assignments')
      .select('*, tasks(id, description, status, severity, due_date, committed_hours)')
      .eq('student_id', sid)
      .order('assigned_date', { ascending: false })
    setAssignments(data || [])
  }

  const startTask = async (assignmentId: string) => {
    setBusy(assignmentId)
    try {
      await axios.post(`${API}/start`, { assignment_id: assignmentId, actor_email: userEmail, actor_role: userRole })
      if (student) await load(student.id)
    } catch (err: any) { toast(errMsg(err, 'Could not start'), 'error') }
    finally { setBusy(null) }
  }

  const completeTask = async (assignmentId: string, desc: string) => {
    const input = prompt(
      `Complete "${desc}".\n\nHours actually spent (optional — leave blank to use the timer):`
    )
    if (input === null) return
    const trimmed = input.trim()
    const actual_hours = trimmed === '' ? undefined : parseFloat(trimmed)
    if (actual_hours !== undefined && (isNaN(actual_hours) || actual_hours < 0)) { toast('Enter a valid number of hours.', 'error'); return }
    setBusy(assignmentId)
    try {
      const res = await axios.post(`${API}/complete`, { assignment_id: assignmentId, actual_hours, actor_email: userEmail, actor_role: userRole })
      const d = res.data
      const basis = d.score != null && d.committed_hours != null ? ` — score ${d.score} (${d.committed_hours}h committed vs ${d.elapsed_hours}h actual)` : (d.score != null ? ` — score ${d.score}` : '')
      toast(`Completed!${userRole === 'leader' ? basis : ''}`, 'success')
      if (student) await load(student.id)
    } catch (err: any) { toast(errMsg(err, 'Could not complete'), 'error') }
    finally { setBusy(null) }
  }

  const severityColor = (s: string) =>
    s === 'Critical' ? 'bg-red-500/20 text-red-400' : s === 'Medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-white/50'

  // Elapsed = banked (accumulated) time + the current running segment (frozen while paused).
  const elapsedSecs = (a: any) => {
    const acc = a.accumulated_seconds || 0
    if (a.paused_at || !a.in_progress_at) return acc
    return acc + Math.max(0, Math.floor((now - new Date(a.in_progress_at).getTime()) / 1000))
  }
  const fmt = (secs: number) => {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
    return `${h}h ${m}m ${s}s`
  }

  const pauseTask = async (assignmentId: string) => {
    setBusy(assignmentId)
    try {
      await axios.post(`${API}/pause`, { assignment_id: assignmentId, actor_email: userEmail, actor_role: userRole })
      if (student) await load(student.id)
    } catch (err: any) { toast(errMsg(err, 'Could not pause'), 'error') }
    finally { setBusy(null) }
  }
  const resumeTask = async (assignmentId: string) => {
    setBusy(assignmentId)
    try {
      await axios.post(`${API}/resume`, { assignment_id: assignmentId, actor_email: userEmail, actor_role: userRole })
      if (student) await load(student.id)
    } catch (err: any) { toast(errMsg(err, 'Could not resume'), 'error') }
    finally { setBusy(null) }
  }

  const active = assignments.filter(a => a.status === 'Assigned' || a.status === 'In Progress')
  const completed = assignments.filter(a => a.status === 'Completed')

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 overflow-y-auto">
        <h1 className="text-2xl font-semibold text-white mb-1">My Tasks</h1>
        <p className="text-xs text-white/40 mb-6">Start a task to run its timer, then mark it complete when you&apos;re done.</p>

        {loading ? (
          <p className="text-white/40 text-sm">Loading...</p>
        ) : notFound ? (
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-lg">
            <p className="text-sm text-white mb-1">No student record linked to your account.</p>
            <p className="text-xs text-white/40">Ask your leader to add you on the Students page using <span className="text-white/70">{userEmail}</span>, then refresh.</p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-2 mb-4 items-center">
              <button onClick={() => setTab('active')}
                className={`text-xs px-4 py-2 rounded-lg border transition ${tab === 'active' ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-white/10 text-white/40 hover:text-white'}`}>
                To do ({active.length})
              </button>
              <button onClick={() => setTab('completed')}
                className={`text-xs px-4 py-2 rounded-lg border transition ${tab === 'completed' ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-white/10 text-white/40 hover:text-white'}`}>
                Completed ({completed.length})
              </button>
              {tab === 'active' && active.some(a => a.status === 'In Progress') && (
                <button onClick={toggleTimers}
                  className="ml-auto text-xs px-3 py-2 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/25 transition">
                  {showTimers ? '⏱ Hide timers' : '⏱ Show timers'}
                </button>
              )}
            </div>

            {tab === 'active' ? (
              active.length === 0 ? (
                <p className="text-white/40 text-sm">Nothing assigned to you right now. 🎉</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {active.map(a => (
                    <div key={a.id} className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4 flex items-center gap-4">
                      <div className="flex-1">
                        <Link href={`/tasks/${a.tasks?.id}`} className="text-sm font-medium text-white hover:underline">{a.tasks?.description || '(task removed)'}</Link>
                        <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                          {a.tasks?.severity && <span className={`text-xs px-2 py-0.5 rounded-full ${severityColor(a.tasks.severity)}`}>{a.tasks.severity}</span>}
                          {a.tasks?.committed_hours != null && <span className="text-xs text-white/40">{a.tasks.committed_hours}h budget</span>}
                          {a.tasks?.due_date && <span className="text-xs text-white/40">due {a.tasks.due_date}</span>}
                        </div>
                      </div>

                      {a.status === 'Assigned' ? (
                        <div className="text-right">
                          <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400">Ready to start</span>
                          <button onClick={() => startTask(a.id)} disabled={busy === a.id}
                            className="block mt-2 text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition disabled:opacity-50">
                            {busy === a.id ? '…' : '▶ Start'}
                          </button>
                        </div>
                      ) : (() => {
                        const paused = !!a.paused_at
                        return (
                        <div className="flex flex-col items-end gap-2">
                          {showTimers ? (
                            <div className={`rounded-lg border px-3 py-1.5 text-right min-w-[7.5rem] ${paused ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                              <p className={`text-lg font-mono font-semibold tabular-nums leading-none ${paused ? 'text-amber-400' : 'text-emerald-400'}`}>{fmt(elapsedSecs(a))}</p>
                              <p className={`text-[10px] mt-1 ${paused ? 'text-amber-400/60' : 'text-emerald-400/60'}`}>⏱ elapsed · {paused ? 'paused' : 'running'}</p>
                            </div>
                          ) : (
                            <span className={`text-xs px-2 py-1 rounded-full ${paused ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{paused ? 'paused' : 'running'}</span>
                          )}
                          <div className="flex gap-2">
                            {paused ? (
                              <button onClick={() => resumeTask(a.id)} disabled={busy === a.id}
                                className="text-xs px-3 py-2 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition disabled:opacity-50">▶ Resume</button>
                            ) : (
                              <button onClick={() => pauseTask(a.id)} disabled={busy === a.id}
                                className="text-xs px-3 py-2 rounded-lg border border-white/20 text-white/60 hover:text-white transition disabled:opacity-50">⏸ Pause</button>
                            )}
                            <button onClick={() => completeTask(a.id, a.tasks?.description || 'this task')} disabled={busy === a.id}
                              className="text-xs px-4 py-2 rounded-lg border border-green-500/30 text-green-400 hover:bg-green-500/10 transition disabled:opacity-50">
                              {busy === a.id ? '…' : '✓ Complete'}
                            </button>
                          </div>
                        </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              )
            ) : (
              completed.length === 0 ? (
                <p className="text-white/40 text-sm">No completed tasks yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {completed.map(a => (
                    <div key={a.id} className="bg-[#1a1a1a] border border-white/10 rounded-xl p-3.5 flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs shrink-0">✓</span>
                      <div className="flex-1">
                        <Link href={`/tasks/${a.tasks?.id}`} className="text-sm text-white hover:underline">{a.tasks?.description || '(task removed)'}</Link>
                        <p className="text-xs text-white/40">
                          {a.completed_at ? `Completed ${new Date(a.completed_at).toLocaleDateString()}` : 'Completed'}
                          {a.actual_hours != null ? ` · ${Math.round(a.actual_hours * 10) / 10}h declared` : ''}
                          {userRole === 'leader' && a.timed_hours != null ? ` · ⏱ ${Math.round(a.timed_hours * 10) / 10}h timed` : ''}
                        </p>
                      </div>
                      {/* scores hidden from students */}
                      {userRole === 'leader' && a.score != null && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60">score {a.score}</span>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {student?.group_label && teamTasks.length > 0 && (
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mt-6">
                <p className="text-sm font-medium text-white mb-1">Team deadlines</p>
                <p className="text-xs text-white/40 mb-4">Active tasks across your group ({student.group_label}), soonest first — plan around them.</p>
                <div className="flex flex-col gap-2">
                  {teamTasks.map((t, i) => {
                    const overdue = t.due_date && t.due_date < new Date().toISOString().slice(0, 10)
                    return (
                      <div key={i} className="flex items-center gap-3 bg-white/5 rounded-lg p-2.5">
                        <span className="text-xs text-white/70 w-28 truncate shrink-0">{t.name}</span>
                        <span className="flex-1 text-sm text-white/80 truncate min-w-0">{t.description}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/45 shrink-0">{t.status === 'In Progress' ? 'Ongoing' : t.status}</span>
                        <span className={`text-xs tabular-nums w-28 text-right shrink-0 ${overdue ? 'text-red-400' : 'text-white/50'}`}>
                          {t.due_date ? `${overdue ? 'overdue · ' : 'due '}${t.due_date}` : 'no due date'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

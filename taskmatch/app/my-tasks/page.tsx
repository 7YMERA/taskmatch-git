'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import Sidebar from '../components/Sidebar'

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

  useEffect(() => { init() }, [])
  // live clock for the running timers
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserEmail(session.user.email || '')
    setUserRole(session.user.user_metadata?.role || 'student')
    const { data: s } = await supabase.from('students').select('*').eq('email', session.user.email).maybeSingle()
    if (!s) { setNotFound(true); setLoading(false); return }
    setStudent(s)
    await load(s.id)
    setLoading(false)
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
    } catch (err: any) { alert(`❌ ${err.response?.data?.detail || 'Failed to start'}`) }
    finally { setBusy(null) }
  }

  const completeTask = async (assignmentId: string, desc: string) => {
    const input = prompt(
      `Complete "${desc}".\n\nHours actually spent (optional — leave blank to use the timer):`
    )
    if (input === null) return
    const trimmed = input.trim()
    const actual_hours = trimmed === '' ? undefined : parseFloat(trimmed)
    if (actual_hours !== undefined && (isNaN(actual_hours) || actual_hours < 0)) { alert('Enter a valid number of hours.'); return }
    setBusy(assignmentId)
    try {
      const res = await axios.post(`${API}/complete`, { assignment_id: assignmentId, actual_hours, actor_email: userEmail, actor_role: userRole })
      alert(`✅ Completed!${userRole === 'leader' && res.data.score != null ? ` Score: ${res.data.score}` : ''}`)
      if (student) await load(student.id)
    } catch (err: any) { alert(`❌ ${err.response?.data?.detail || 'Failed to complete'}`) }
    finally { setBusy(null) }
  }

  const severityColor = (s: string) =>
    s === 'Critical' ? 'bg-red-500/20 text-red-400' : s === 'Medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-white/50'

  const elapsed = (startIso: string) => {
    if (!startIso) return '0h 0m 0s'
    const secs = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000))
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
    return `${h}h ${m}m ${s}s`
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
            <div className="flex gap-2 mb-4">
              <button onClick={() => setTab('active')}
                className={`text-xs px-4 py-2 rounded-lg border transition ${tab === 'active' ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-white/10 text-white/40 hover:text-white'}`}>
                To do ({active.length})
              </button>
              <button onClick={() => setTab('completed')}
                className={`text-xs px-4 py-2 rounded-lg border transition ${tab === 'completed' ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-white/10 text-white/40 hover:text-white'}`}>
                Completed ({completed.length})
              </button>
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
                      ) : (
                        <div className="text-right">
                          <p className="text-lg font-mono font-semibold text-emerald-400 tabular-nums">{elapsed(a.in_progress_at)}</p>
                          <p className="text-[10px] text-white/30 mb-2">running</p>
                          <button onClick={() => completeTask(a.id, a.tasks?.description || 'this task')} disabled={busy === a.id}
                            className="text-xs px-4 py-2 rounded-lg border border-green-500/30 text-green-400 hover:bg-green-500/10 transition disabled:opacity-50">
                            {busy === a.id ? '…' : '✓ Complete'}
                          </button>
                        </div>
                      )}
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
          </>
        )}
      </main>
    </div>
  )
}

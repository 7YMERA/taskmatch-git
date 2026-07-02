'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import Sidebar from '../components/Sidebar'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Dashboard() {
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string>('')
  const [userRole, setUserRole] = useState<string>('')
  const [students, setStudents] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [statsList, setStatsList] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email || '')
      setUserRole(session.user.user_metadata?.role || 'student')
    })
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    const { data: studentRows } = await supabase.from('students').select('id, name, programme')
    const { data: taskRows } = await supabase.from('tasks').select('id, description, status, severity, due_date, committed_hours, completed_at')
    const { data: assignmentRows } = await supabase.from('assignments').select('task_id, student_id, status, score, actual_hours, completed_at')
    setStudents(studentRows || [])
    setTasks(taskRows || [])
    setAssignments(assignmentRows || [])
    try {
      const res = await axios.get(`${API}/student-stats`)
      setStatsList(res.data.stats)
    } catch { /* backend down — scores just won't show */ }
    setLoading(false)
  }

  const initials = (name: string) =>
    name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  const bandClass = (band: string) => ({
    high: 'bg-emerald-500/20 text-emerald-400',
    avg: 'bg-amber-500/20 text-amber-400',
    low: 'bg-red-500/20 text-red-400',
    unrated: 'bg-white/10 text-white/40',
  }[band] || 'bg-white/10 text-white/40')

  const statusColor = (status: string) => {
    if (status === 'New') return 'bg-yellow-500/20 text-yellow-400'
    if (status === 'In Progress') return 'bg-green-500/20 text-green-400'
    if (status === 'Completed') return 'bg-blue-500/20 text-blue-400'
    return 'bg-white/10 text-white/40'
  }

  const scoreBand = (s: number) => s >= 0.6 ? 'high' : s >= 0.4 ? 'avg' : 'low'

  const totalStudents = students.length
  const today = new Date().toISOString().slice(0, 10)

  // SLA states: Delayed = breached & not done (active); Closed = breached & not
  // done past the grace window (locked); Late = delivered after the due date.
  const GRACE_DAYS = 7
  const daysOverdue = (due: string) => Math.floor((Date.parse(today) - Date.parse(due)) / 86400000)
  const isClosed = (t: any) => t.status !== 'Completed' && t.due_date && daysOverdue(t.due_date) > GRACE_DAYS
  const isDelayed = (t: any) => t.status !== 'Completed' && t.due_date && t.due_date < today && !isClosed(t)
  const isLate = (t: any) => t.status === 'Completed' && t.completed_at && t.completed_at.slice(0, 10) > t.due_date

  const newCount = tasks.filter(t => t.status === 'New').length
  const ongoingCount = tasks.filter(t => t.status === 'In Progress').length
  const completedCount = tasks.filter(t => t.status === 'Completed').length
  const delayedCount = tasks.filter(isDelayed).length
  const closedCount = tasks.filter(isClosed).length
  const lateCount = tasks.filter(isLate).length

  // Completed-assignment performance
  const doneAssignments = assignments.filter(a => a.status === 'Completed')
  const scored = doneAssignments.filter(a => a.score != null)
  const timed = doneAssignments.filter(a => a.actual_hours != null)
  const avgScore = scored.length ? (scored.reduce((s, a) => s + a.score, 0) / scored.length).toFixed(2) : '—'
  const avgTime = timed.length ? (timed.reduce((s, a) => s + a.actual_hours, 0) / timed.length).toFixed(1) : '—'

  // Performance grouped by task
  const taskMap: { [id: string]: any } = {}
  tasks.forEach(t => { taskMap[t.id] = t })
  const perTask = Object.values(
    doneAssignments.reduce((acc: any, a: any) => {
      const id = a.task_id
      if (!acc[id]) acc[id] = { task_id: id, scores: [], hours: [], count: 0 }
      if (a.score != null) acc[id].scores.push(a.score)
      if (a.actual_hours != null) acc[id].hours.push(a.actual_hours)
      acc[id].count++
      return acc
    }, {})
  ).map((g: any) => ({
    task_id: g.task_id,
    description: taskMap[g.task_id]?.description || '(removed task)',
    avgScore: g.scores.length ? g.scores.reduce((x: number, y: number) => x + y, 0) / g.scores.length : null,
    avgHours: g.hours.length ? g.hours.reduce((x: number, y: number) => x + y, 0) / g.hours.length : null,
    count: g.count,
  })).filter((t: any) => t.avgScore != null) as any[]

  const byScoreDesc = [...perTask].sort((a, b) => b.avgScore - a.avgScore)
  const fastest = byScoreDesc[0] || null
  const slowest = byScoreDesc.length > 1 ? byScoreDesc[byScoreDesc.length - 1] : null

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <h1 className="text-2xl font-semibold text-white mb-6">Dashboard</h1>

        {/* KPI cards */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[
            { label: 'Total students', value: loading ? '…' : `${totalStudents}`, sub: 'CS, IT & IS cohort', href: '/students' },
            { label: 'Avg performance score', value: loading ? '…' : `${avgScore}`, sub: `${scored.length} completed task${scored.length === 1 ? '' : 's'} scored`, href: '/students' },
            { label: 'Avg completion time', value: loading ? '…' : (avgTime === '—' ? '—' : `${avgTime}h`), sub: 'per completed task', href: '/tasks?status=Completed' },
            { label: 'Tasks completed', value: loading ? '…' : `${completedCount}`, sub: `of ${tasks.length} total`, href: '/tasks?status=Completed' },
          ].map(m => (
            <Link key={m.label} href={m.href}
              className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4 hover:border-white/25 hover:bg-white/[0.03] transition group">
              <p className="text-xs text-white/40 mb-1 flex items-center justify-between">
                {m.label}
                <span className="opacity-0 group-hover:opacity-100 transition text-white/30">→</span>
              </p>
              <p className="text-2xl font-semibold text-white">{m.value}</p>
              <p className="text-xs text-white/30 mt-1">{m.sub}</p>
            </Link>
          ))}
        </div>

        {/* Lifecycle status breakdown — each card opens the Tasks page pre-filtered */}
        <div className="grid grid-cols-5 gap-4 mb-6">
          {[
            { label: 'New', value: newCount, color: 'text-yellow-400', sub: 'awaiting assignment', filter: 'New' },
            { label: 'Ongoing', value: ongoingCount, color: 'text-green-400', sub: 'in progress', filter: 'In Progress' },
            { label: 'Completed', value: completedCount, color: 'text-blue-400', sub: `done${lateCount ? ` · ${lateCount} late` : ''}`, filter: 'Completed' },
            { label: 'Delayed', value: delayedCount, color: 'text-red-400', sub: 'SLA breached, not done', filter: 'Delayed' },
            { label: 'Closed', value: closedCount, color: 'text-white/60', sub: `auto-locked > ${GRACE_DAYS}d overdue`, filter: 'Closed' },
          ].map(m => (
            <Link key={m.label} href={`/tasks?status=${encodeURIComponent(m.filter)}`}
              className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4 hover:border-white/25 hover:bg-white/[0.03] transition group">
              <p className="text-xs text-white/40 mb-1 flex items-center justify-between">
                {m.label}
                <span className="opacity-0 group-hover:opacity-100 transition text-white/30">→</span>
              </p>
              <p className={`text-2xl font-semibold ${m.color}`}>{loading ? '…' : m.value}</p>
              <p className="text-xs text-white/30 mt-1">{m.sub}</p>
            </Link>
          ))}
        </div>

        {/* Fastest / slowest task */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          {[
            { title: 'Fastest task', icon: '⚡', t: fastest },
            { title: 'Slowest task', icon: '🐢', t: slowest },
          ].map(card => (
            <div key={card.title} className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
              <p className="text-sm font-medium text-white mb-1">{card.icon} {card.title}</p>
              <p className="text-xs text-white/40 mb-3">By efficiency score (committed vs actual hours)</p>
              {loading ? <p className="text-white/40 text-sm">Loading…</p>
                : !card.t ? <p className="text-white/40 text-sm">Not enough completed tasks yet.</p>
                : (
                  <Link href={`/tasks/${card.t.task_id}`} className="block hover:bg-white/5 -mx-2 px-2 py-1 rounded transition">
                    <p className="text-sm text-white truncate">{card.t.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${bandClass(scoreBand(card.t.avgScore))}`}>score {card.t.avgScore.toFixed(2)}</span>
                      {card.t.avgHours != null && <span className="text-xs text-white/40">avg {Math.round(card.t.avgHours * 10) / 10}h</span>}
                      <span className="text-xs text-white/30">· {card.t.count} contributor{card.t.count === 1 ? '' : 's'}</span>
                    </div>
                  </Link>
                )}
            </div>
          ))}
        </div>

        {/* Performance by task + Team performance */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
            <p className="text-sm font-medium text-white mb-1">Performance by task</p>
            <p className="text-xs text-white/40 mb-4">Completed tasks — avg time &amp; efficiency, best first</p>
            {loading ? <p className="text-white/40 text-sm">Loading…</p>
              : perTask.length === 0 ? <p className="text-white/40 text-sm">No completed tasks yet.</p>
              : (
                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                  {byScoreDesc.map(t => (
                    <Link key={t.task_id} href={`/tasks/${t.task_id}`}
                      className="flex items-center gap-3 bg-white/5 rounded-lg p-2.5 hover:bg-white/10 transition">
                      <span className="flex-1 text-sm text-white truncate">{t.description}</span>
                      {t.avgHours != null && <span className="text-xs text-white/40">{Math.round(t.avgHours * 10) / 10}h</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${bandClass(scoreBand(t.avgScore))}`}>{t.avgScore.toFixed(2)}</span>
                    </Link>
                  ))}
                </div>
              )}
          </div>

          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
            <p className="text-sm font-medium text-white mb-1">Team performance</p>
            <p className="text-xs text-white/40 mb-4">Average individual score (efficiency vs committed hours)</p>
            {loading ? (
              <p className="text-white/40 text-sm">Loading...</p>
            ) : statsList.length === 0 ? (
              <p className="text-white/40 text-sm">No students yet.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                {[...statsList].sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1)).map(s => (
                  <Link key={s.student_id} href={`/students/${s.student_id}`}
                    className="flex items-center gap-3 bg-white/5 rounded-lg p-2.5 hover:bg-white/10 transition">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold shrink-0">
                      {initials(s.name)}
                    </div>
                    <span className="flex-1 text-sm text-white truncate">{s.name}</span>
                    <span className="text-xs text-white/30">{s.completed_count} done</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${bandClass(s.band)}`}>
                      {s.band === 'unrated' ? '— unrated' : `${s.avg_score} · ${s.band}`}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
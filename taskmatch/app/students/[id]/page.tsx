'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import Sidebar from '../../components/Sidebar'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PROFICIENCY = ['', 'Beginner', 'Intermediate', 'Advanced']

export default function StudentDetail() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('')
  const [student, setStudent] = useState<any>(null)
  const [assignments, setAssignments] = useState<any[]>([])
  const [stat, setStat] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email || '')
      setUserRole(session.user.user_metadata?.role || 'student')
    })
    loadAll()
  }, [id])

  const loadAll = async () => {
    const { data: s } = await supabase
      .from('students')
      .select('*, student_skills(skill_id, proficiency, skills(skill_name))')
      .eq('id', id).single()
    setStudent(s)

    const { data: a } = await supabase
      .from('assignments')
      .select('*, tasks(id, description, status, severity, due_date)')
      .eq('student_id', id)
      .order('assigned_date', { ascending: false })
    setAssignments(a || [])

    try {
      const res = await axios.get(`${API}/student-stats`)
      setStat(res.data.stats.find((x: any) => x.student_id === id) || null)
    } catch { /* backend down */ }
    setLoading(false)
  }

  const bandClass = (band: string) => ({
    high: 'bg-emerald-500/20 text-emerald-400',
    avg: 'bg-amber-500/20 text-amber-400',
    low: 'bg-red-500/20 text-red-400',
    unrated: 'bg-white/10 text-white/40',
  }[band] || 'bg-white/10 text-white/40')

  const statusColor = (s: string) =>
    s === 'New' ? 'bg-yellow-500/20 text-yellow-400'
      : s === 'In Progress' ? 'bg-green-500/20 text-green-400'
      : s === 'Completed' ? 'bg-blue-500/20 text-blue-400'
      : 'bg-white/10 text-white/40'

  const initials = (n: string) => n?.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()

  const active = assignments.filter(a => a.status === 'In Progress')
  const done = assignments.filter(a => a.status === 'Completed')

  // Dashboard-style stats for this student
  const timed = done.filter(a => a.actual_hours != null)
  const avgTime = timed.length ? (timed.reduce((s, a) => s + a.actual_hours, 0) / timed.length).toFixed(1) : '—'
  const onTime = done.filter(a => a.completed_at && a.tasks?.due_date && a.completed_at.slice(0, 10) <= a.tasks.due_date).length
  const lateDeliveries = done.length - onTime
  const totalHours = timed.reduce((s, a) => s + a.actual_hours, 0)
  const avgScoreDisplay = stat && stat.avg_score != null ? stat.avg_score : '—'
  const band = stat?.band || 'unrated'

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <Link href="/students" className="text-xs text-white/40 hover:text-white">← Back to students</Link>

        {loading ? (
          <p className="text-white/40 text-sm mt-6">Loading...</p>
        ) : !student ? (
          <p className="text-white/40 text-sm mt-6">Student not found.</p>
        ) : (
          <>
            {/* Header */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mt-4 mb-6">
              <div className="flex items-center gap-4">
                {student.avatar_url
                  ? <img src={student.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
                  : <div className="w-14 h-14 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-lg font-semibold shrink-0">{initials(student.name)}</div>}
                <div className="flex-1">
                  <p className="text-lg font-semibold text-white">{student.name}</p>
                  <p className="text-xs text-white/40">{student.matric} · {student.programme} · Year {student.year}</p>
                </div>
                <div className="text-right">
                  {stat && (
                    <>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${bandClass(stat.band)}`}>
                        {stat.band === 'unrated' ? '— unrated' : `${stat.avg_score} · ${stat.band}`}
                      </span>
                      <p className="text-xs text-white/30 mt-1">{stat.completed_count} completed · {active.length} active</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Stat cards — mini dashboard for this student */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
              {[
                { label: 'Avg score', value: avgScoreDisplay, sub: band === 'unrated' ? 'no data yet' : band, color: bandClass(band).split(' ')[1] || 'text-white' },
                { label: 'Assigned', value: assignments.length, sub: 'total tasks', color: 'text-white' },
                { label: 'Completed', value: done.length, sub: 'finished', color: 'text-blue-400' },
                { label: 'Active', value: active.length, sub: 'in progress', color: 'text-green-400' },
                { label: 'Avg time', value: avgTime === '—' ? '—' : `${avgTime}h`, sub: 'per task', color: 'text-white' },
                { label: 'Late', value: lateDeliveries, sub: `${onTime} on time`, color: lateDeliveries > 0 ? 'text-amber-400' : 'text-white/60' },
              ].map(m => (
                <div key={m.label} className="bg-[#1a1a1a] border border-white/10 rounded-xl p-3">
                  <p className="text-[11px] text-white/40 mb-1">{m.label}</p>
                  <p className={`text-xl font-semibold ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] text-white/30 mt-0.5 capitalize">{m.sub}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Skills */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
                <p className="text-sm font-medium text-white mb-4">Declared skills</p>
                {(student.student_skills || []).length === 0 ? (
                  <p className="text-xs text-white/40">No skills declared.</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {student.student_skills.map((ss: any) => (
                      <span key={ss.skill_id} className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">
                        {ss.skills?.skill_name} · {PROFICIENCY[ss.proficiency]}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Active tasks */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
                <p className="text-sm font-medium text-white mb-4">Active tasks ({active.length})</p>
                {active.length === 0 ? (
                  <p className="text-xs text-white/40">No active tasks.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {active.map(a => (
                      <Link key={a.id} href={`/tasks/${a.tasks?.id}`} className="flex items-center gap-3 bg-white/5 rounded-lg p-3 hover:bg-white/10 transition">
                        <span className="flex-1 text-sm text-white">{a.tasks?.description || '(removed)'}</span>
                        <span className={`text-xs px-2 py-1 rounded-full ${statusColor(a.status)}`}>{a.status}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Completion history */}
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mt-6">
              <p className="text-sm font-medium text-white mb-4">Completion history ({done.length})</p>
              {done.length === 0 ? (
                <p className="text-xs text-white/40">No completed tasks yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {done.map(a => (
                    <div key={a.id} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                      <Link href={`/tasks/${a.tasks?.id}`} className="flex-1 text-sm text-white hover:underline">{a.tasks?.description || '(removed)'}</Link>
                      <span className="text-xs text-white/40">
                        {a.actual_hours != null ? `${Math.round(a.actual_hours * 10) / 10}h declared` : ''}
                        {userRole === 'leader' && a.timed_hours != null ? ` · ⏱ ${Math.round(a.timed_hours * 10) / 10}h timed` : ''}
                      </span>
                      {a.score != null && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${a.score >= 0.6 ? 'bg-emerald-500/20 text-emerald-400' : a.score >= 0.4 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                          score {a.score}
                        </span>
                      )}
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

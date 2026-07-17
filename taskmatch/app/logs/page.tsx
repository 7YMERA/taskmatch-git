'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import Sidebar from '../components/Sidebar'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Logs() {
  const router = useRouter()
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('')
  const [logs, setLogs] = useState<any[]>([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email || '')
      setUserRole(session.user.user_metadata?.role || 'student')
      setReady(true)
    })
    fetchLogs()
  }, [])

  const fetchLogs = async () => {
    const { data } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    setLogs(data || [])
    setLoading(false)
  }

  const actionColor = (action: string) => {
    if (action.includes('deleted') || action.includes('removed')) return 'bg-red-500/20 text-red-400'
    if (action.includes('completed')) return 'bg-blue-500/20 text-blue-400'
    if (action.includes('created') || action.includes('added') || action.includes('assigned')) return 'bg-emerald-500/20 text-emerald-400'
    return 'bg-white/10 text-white/50'
  }

  // Filter by entity type + free-text search across actor, action, summary and details.
  const q = search.trim().toLowerCase()
  const shown = logs.filter(l => {
    if (filter !== 'all' && l.entity_type !== filter) return false
    if (!q) return true
    return [l.actor_email, l.action, l.summary, l.entity_type, l.details && JSON.stringify(l.details)]
      .some(v => (v || '').toString().toLowerCase().includes(q))
  })
  const entityTypes = Array.from(new Set(logs.map(l => l.entity_type).filter(Boolean))).sort()
  const filters = ['all', ...entityTypes]
  const countFor = (f: string) => f === 'all' ? logs.length : logs.filter(l => l.entity_type === f).length

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <h1 className="text-2xl font-semibold text-white mb-1">Activity log</h1>
        <p className="text-xs text-white/40 mb-6">
          Append-only audit trail of every action. Entries cannot be edited or deleted (enforced at the database).
        </p>

        {!ready ? (
          <p className="text-white/40 text-sm">Loading...</p>
        ) : userRole !== 'leader' ? (
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-lg">
            <p className="text-sm text-white mb-1">Leaders only.</p>
            <p className="text-xs text-white/40">
              The activity log is visible to team leaders. You&apos;re signed in as
              <span className="text-white/70"> {userEmail}</span> (student).
            </p>
          </div>
        ) : (
          <>
            <div className="relative mb-4 max-w-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by person, action, or anything…"
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-9 py-2.5 text-sm text-white placeholder-white/25 outline-none focus:border-indigo-500 transition"
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white text-sm">✕</button>
              )}
            </div>

            <div className="flex gap-2 mb-4 flex-wrap items-center">
              {filters.map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border capitalize transition ${filter === f
                    ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                    : 'border-white/10 text-white/40 hover:text-white'}`}>
                  {f}
                  <span className={`text-[10px] px-1.5 rounded-full ${filter === f ? 'bg-indigo-500/30 text-indigo-200' : 'bg-white/10 text-white/40'}`}>{countFor(f)}</span>
                </button>
              ))}
            </div>

            {loading ? (
              <p className="text-white/40 text-sm">Loading...</p>
            ) : shown.length === 0 ? (
              <p className="text-white/40 text-sm">{q || filter !== 'all' ? 'No matching activity.' : 'No activity recorded yet.'}</p>
            ) : (
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-white/40 border-b border-white/10">
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(l => (
                      <tr key={l.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                        <td className="px-4 py-3 text-xs text-white/50 whitespace-nowrap">
                          {new Date(l.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="text-white/80">{l.actor_email || 'system'}</span>
                          {l.actor_role && <span className="text-white/30"> · {l.actor_role}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${actionColor(l.action)}`}>{l.action}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-white/60">{l.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

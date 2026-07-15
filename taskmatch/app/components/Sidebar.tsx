'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Shared left navigation. "My Profile" lives at the bottom with the user's photo.
export default function Sidebar() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const e = session.user.email || ''
      setEmail(e)
      setRole(session.user.user_metadata?.role || 'student')
      const { data } = await supabase.from('students').select('name, avatar_url').eq('email', e).maybeSingle()
      if (data) { setName(data.name || ''); setAvatar(data.avatar_url || null) }
    })
  }, [])

  const initials = (n: string) =>
    (n || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()

  const nav = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Tasks', href: '/tasks' },
    { label: 'My Tasks', href: '/my-tasks' },
    { label: 'Students', href: '/students' },
    ...(role === 'leader' ? [{ label: 'Logs', href: '/logs' }] : []),
  ]

  return (
    <aside className="w-52 bg-[#1a1a1a] border-r border-white/10 p-4 flex flex-col gap-1 shrink-0 sticky top-0 h-screen overflow-y-auto self-start">
      <div className="flex flex-col items-center gap-2 py-3 mb-3 border-b border-white/10">
        <svg width="46" height="46" viewBox="0 0 42 42" fill="none" aria-label="TaskMatch logo"
          className="drop-shadow-[0_2px_10px_rgba(99,102,241,0.4)]">
          <defs>
            <linearGradient id="tmLogo" x1="4" y1="4" x2="38" y2="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#6366f1" />
              <stop offset="0.5" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#34d399" />
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="36" height="36" rx="11" fill="url(#tmLogo)" />
          <line x1="15.5" y1="15.5" x2="26.5" y2="26.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
          <circle cx="15" cy="15" r="3.6" fill="#fff" />
          <rect x="22.5" y="22.5" width="7" height="7" rx="2.2" fill="#fff" />
        </svg>
        <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
          TaskMatch
        </span>
      </div>
      {nav.map(item => (
        <Link key={item.href} href={item.href}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/10 transition">
          {item.label}
        </Link>
      ))}

      <div className="mt-auto pt-4 border-t border-white/10">
        <Link href="/profile"
          className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition">
          {avatar ? (
            <img src={avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-semibold shrink-0">
              {initials(name || email)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs text-white font-medium">My Profile</p>
            <p className="text-[11px] text-white/40 truncate">{email}</p>
          </div>
        </Link>
        <div className="px-3 mt-1">
          <span className={`px-2 py-0.5 rounded-full text-xs ${role === 'leader' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-green-500/20 text-green-400'}`}>
            {role || 'student'}
          </span>
        </div>
        <button onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition mt-2">
          Sign out
        </button>
      </div>
    </aside>
  )
}

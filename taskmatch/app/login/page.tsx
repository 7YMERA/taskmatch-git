'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SIGNIN_MSGS = ['Signing you in…', 'Loading your workspace…', 'Almost there…']

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [welcomeName, setWelcomeName] = useState('')
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!signingIn) return
    const id = setInterval(() => setStep(s => Math.min(s + 1, SIGNIN_MSGS.length - 1)), 550)
    return () => clearInterval(id)
  }, [signingIn])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setWelcomeName(data.user?.user_metadata?.full_name || '')
      setSigningIn(true)                                    // show the buffer, then go
      setTimeout(() => router.push('/dashboard'), 1900)
    }
  }

  // Buffer screen after a successful sign-in, before the dashboard.
  if (signingIn) {
    return (
      <div className="relative min-h-screen bg-[#111111] overflow-hidden flex items-center justify-center px-6">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl animate-pulse" />
          <div className="absolute bottom-0 -right-24 w-[28rem] h-[28rem] rounded-full bg-violet-600/20 blur-3xl animate-pulse" />
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        </div>
        <div className="relative z-10 text-center">
          <div className="mx-auto mb-8 w-20 h-20 relative">
            <div className="absolute inset-0 rounded-full border-4 border-white/10" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-400 border-r-emerald-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-2xl">👋</div>
          </div>
          <h1 className="text-2xl font-bold mb-2">
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
              Welcome back{welcomeName ? `, ${welcomeName.split(' ')[0]}` : ''}!
            </span>
          </h1>
          <p className="text-sm text-white/50 transition-opacity duration-300">{SIGNIN_MSGS[step]}</p>
          <div className="w-60 h-1.5 rounded-full bg-white/10 overflow-hidden mx-auto mt-6">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${((step + 1) / SIGNIN_MSGS.length) * 100}%` }} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#111111] overflow-hidden flex items-center justify-center px-6">
      {/* ambient background — same as the landing */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute bottom-0 -right-24 w-[28rem] h-[28rem] rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      </div>

      <div className="relative z-10 w-full max-w-sm bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl p-8">
        <Link href="/" className="text-xs text-white/40 hover:text-white">← Home</Link>

        <div className="mt-4 mb-7">
          <h1 className="text-3xl font-bold">
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">TaskMatch</span>
          </h1>
          <p className="text-sm text-white/40 mt-1">Welcome back — sign in to continue.</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@utp.edu.my"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
            />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition disabled:opacity-50 shadow-lg shadow-indigo-600/20">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-white/40 mt-6 text-center">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-indigo-400 hover:text-indigo-300">Sign up</Link>
        </p>
      </div>
    </div>
  )
}

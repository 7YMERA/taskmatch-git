'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const CREATING_MSGS = ['Creating your account…', 'Setting up your workspace…', 'Getting things ready…', 'Almost there…']

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function SignUp() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [step, setStep] = useState(0)

  // Cycle the status messages while the buffer screen is up.
  useEffect(() => {
    if (!creating) return
    const id = setInterval(() => setStep(s => Math.min(s + 1, CREATING_MSGS.length - 1)), 550)
    return () => clearInterval(id)
  }, [creating])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role: 'student', full_name: name } },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    if (data.session) {
      setCreating(true)                                   // show the buffer, then go
      setTimeout(() => router.push('/dashboard'), 2400)
    } else {
      setDone(true)
      setLoading(false)
    }
  }

  // Buffer screen after a successful sign-up (auto-login), before landing on the dashboard.
  if (creating) {
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
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-400 border-r-violet-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-2xl">🚀</div>
          </div>
          <h1 className="text-2xl font-bold mb-2">
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
              Welcome{name ? `, ${name.split(' ')[0]}` : ''}!
            </span>
          </h1>
          <p className="text-sm text-white/50 transition-opacity duration-300">{CREATING_MSGS[step]}</p>
          <div className="w-60 h-1.5 rounded-full bg-white/10 overflow-hidden mx-auto mt-6">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${((step + 1) / CREATING_MSGS.length) * 100}%` }} />
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

        {done ? (
          <div className="mt-4">
            <h1 className="text-2xl font-semibold text-white mb-2">Check your email</h1>
            <p className="text-sm text-white/50 mb-6">
              We sent a confirmation link to <span className="text-white/80">{email}</span>. Confirm it,
              then sign in. (If email confirmation is off for the project, you can sign in right away.)
            </p>
            <Link href="/login"
              className="block text-center w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition">
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-4 mb-7">
              <h1 className="text-3xl font-bold">
                <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">TaskMatch</span>
              </h1>
              <p className="text-sm text-white/40 mt-1">Create your account to get started.</p>
            </div>

            <form onSubmit={handleSignup} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-white/40 mb-1 block">Full name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
                />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@utp.edu.my"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
                />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
                />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className={`w-full bg-white/5 border rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none transition ${confirmPassword && confirmPassword !== password ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-indigo-500'}`}
                />
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition disabled:opacity-50 shadow-lg shadow-indigo-600/20">
                {loading ? 'Creating account...' : 'Sign up'}
              </button>
            </form>

            <p className="text-xs text-white/40 mt-6 text-center">
              Already have an account?{' '}
              <Link href="/login" className="text-indigo-400 hover:text-indigo-300">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

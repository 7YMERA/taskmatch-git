'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function Landing() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [active, setActive] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { router.replace('/dashboard'); return }
      setChecking(false)
    })
  }, [])

  // Auto-advance the feature showcase like a slideshow.
  useEffect(() => {
    const id = setInterval(() => setActive(a => (a + 1) % 4), 3500)
    return () => clearInterval(id)
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center">
        <p className="text-white/30 text-sm">Loading…</p>
      </div>
    )
  }

  // ─── Feature slides (right-hand showcase) ───
  const MatchVisual = (
    <div className="w-full max-w-[400px] space-y-3">
      {[
        { n: 'Rizzuansyah', b: 'high', c: '#34d399', top: true },
        { n: 'Siti Farhana', b: 'avg', c: '#fbbf24' },
        { n: 'Eason', b: 'learner', c: '#fb7185' },
      ].map(r => (
        <div key={r.n} className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${r.top ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/10 bg-white/5'}`}>
          <div className="w-10 h-10 rounded-full shrink-0" style={{ background: r.c + '33' }} />
          <span className="text-sm text-white flex-1">{r.n}</span>
          <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: r.c + '22', color: r.c }}>{r.b}</span>
        </div>
      ))}
      <p className="text-xs text-violet-300 text-center pt-2">⚖️ balanced pair suggested</p>
    </div>
  )
  const ScoreVisual = (
    <div className="text-center">
      <div className="text-8xl font-bold leading-none" style={{ color: '#34d399' }}>0.67</div>
      <p className="text-xs text-white/40 mb-4 mt-2">efficiency score</p>
      <div className="w-72 h-3 rounded-full bg-white/10 overflow-hidden mx-auto">
        <div className="h-full rounded-full" style={{ width: '67%', background: '#34d399' }} />
      </div>
      <p className="text-xs text-white/40 mt-3">8h committed · 4h actual</p>
    </div>
  )
  const AuditVisual = (
    <div className="w-full max-w-[400px] space-y-2.5">
      {['task.completed — Ahmad (0.67)', 'assignment.assigned — Siti', 'group.created — Sprint Squad'].map(l => (
        <div key={l} className="flex items-center gap-2.5 text-xs rounded-lg bg-white/5 border border-white/10 px-3.5 py-2.5">
          <span className="text-emerald-400">●</span>
          <span className="text-white/60 truncate">{l}</span>
        </div>
      ))}
      <p className="text-xs text-rose-300 text-center pt-2">🔒 immutable — can&apos;t be edited or deleted</p>
    </div>
  )
  const GroupsVisual = (
    <div className="w-full max-w-[400px] space-y-4">
      {[{ g: 'Sprint Squad', c: '#38bdf8', m: 4 }, { g: 'Tak Tido Group', c: '#a78bfa', m: 3 }].map(grp => (
        <div key={grp.g} className="rounded-xl border px-4 py-4" style={{ borderColor: grp.c + '55', background: grp.c + '11' }}>
          <p className="text-xs mb-2.5" style={{ color: grp.c }}>{grp.g}</p>
          <div className="flex -space-x-2.5">
            {Array.from({ length: grp.m }).map((_, i) => (
              <div key={i} className="w-9 h-9 rounded-full border-2 border-[#111]" style={{ background: grp.c + '55' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  const SLIDES = [
    { key: 'match', icon: '⚡', title: 'Smart matching', desc: 'Rank students by skill fit and performance, with a balanced strong + learner pairing suggested automatically.', accent: '#a78bfa', visual: MatchVisual },
    { key: 'score', icon: '📊', title: 'Performance scoring', desc: 'Every completed task scores efficiency (committed vs actual hours) and rolls up into each student’s average.', accent: '#34d399', visual: ScoreVisual },
    { key: 'audit', icon: '🛡', title: 'Immutable audit log', desc: 'Every action is recorded, attributed and time-stamped — and can never be edited or deleted.', accent: '#fb7185', visual: AuditVisual },
    { key: 'groups', icon: '👥', title: 'Team groups', desc: 'Organise people and tasks into colour-coded groups — like departments within a project.', accent: '#38bdf8', visual: GroupsVisual },
  ]

  return (
    <div className="relative min-h-screen bg-[#111111] overflow-hidden flex items-center">
      {/* ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-[28rem] h-[28rem] rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 rounded-full bg-emerald-600/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-8 grid md:grid-cols-5 gap-10 items-center">
        {/* LEFT — branding + actions + live dynamics */}
        <div className="md:col-span-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-white/50 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Final Year Project · TaskMatch
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">TaskMatch</span>
          </h1>
          <p className="text-lg text-white/70 mb-2">Skill-based task allocation for student teams.</p>
          <p className="text-sm text-white/40 mb-8 max-w-md">
            Match the right people to the right tasks, track performance over time, and keep an
            auditable record of who did what.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/login"
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition shadow-lg shadow-indigo-600/20">
              Log in
            </Link>
            <Link href="/signup"
              className="px-6 py-3 rounded-xl border border-white/15 text-white/80 hover:bg-white/5 text-sm font-medium transition">
              Sign up
            </Link>
          </div>

          {/* separating line + at-a-glance feature list */}
          <div className="mt-10 pt-8 border-t border-white/10 max-w-md">
            <p className="text-[11px] uppercase tracking-wider text-white/30 mb-3">What it does</p>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              {[
                { i: '⚡', t: 'Smart matching', c: '#a78bfa' },
                { i: '📊', t: 'Performance scoring', c: '#34d399' },
                { i: '🛡', t: 'Immutable audit log', c: '#fb7185' },
                { i: '👥', t: 'Team groups', c: '#38bdf8' },
              ].map(f => (
                <div key={f.t} className="flex items-center gap-2 text-xs text-white/60">
                  <span>{f.i}</span>{f.t}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — auto-rotating feature showcase (dominant) */}
        <div className="md:col-span-3 md:border-l md:border-white/10 md:pl-10">
          <div className="relative h-[520px] rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
            {/* accent glow per slide */}
            <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl transition-colors duration-700"
              style={{ backgroundColor: SLIDES[active].accent + '33' }} />

            {SLIDES.map((s, i) => (
              <div key={s.key}
                className={`absolute inset-0 p-9 flex flex-col transition-all duration-700 ease-out ${i === active ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6 pointer-events-none'}`}>
                <div className="flex items-center gap-2 text-sm text-white/40">
                  <span className="text-lg">{s.icon}</span>
                  <span>{`0${i + 1}`} / 04</span>
                </div>
                <div className="flex-1 flex items-center justify-center py-4">{s.visual}</div>
                <div>
                  <p className="text-xl font-semibold" style={{ color: s.accent }}>{s.title}</p>
                  <p className="text-sm text-white/50 mt-1.5 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* progress dots */}
          <div className="flex gap-2 justify-center mt-4">
            {SLIDES.map((s, i) => (
              <button key={s.key} onClick={() => setActive(i)} aria-label={s.title}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{ width: i === active ? 26 : 8, backgroundColor: i === active ? s.accent : 'rgba(255,255,255,0.2)' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

// Reusable donut chart with a legend. Segments are drawn as dash-offset arcs.
export default function Donut({
  data,
  centerLabel = 'total',
}: {
  data: { label: string; color: string; value: number }[]
  centerLabel?: string
}) {
  const total = data.reduce((s, x) => s + x.value, 0)
  if (total === 0) return <p className="text-white/40 text-sm">No data yet.</p>
  const C = 2 * Math.PI * 54
  let offset = 0
  return (
    <div className="flex items-center gap-6">
      <div className="relative w-40 h-40 shrink-0">
        <svg viewBox="0 0 140 140" className="w-40 h-40 -rotate-90">
          <circle cx="70" cy="70" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="20" />
          {data.map(s => {
            const len = (s.value / total) * C
            const seg = (
              <circle key={s.label} cx="70" cy="70" r="54" fill="none" stroke={s.color} strokeWidth="20"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} strokeLinecap="butt">
                <title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title>
              </circle>
            )
            offset += len
            return seg
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-white leading-none">{total}</span>
          <span className="text-[10px] text-white/40 mt-1">{centerLabel}</span>
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        {data.map(s => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-white/70 flex-1">{s.label}</span>
            <span className="text-white/50 tabular-nums">{s.value}</span>
            <span className="text-white/30 tabular-nums w-9 text-right">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

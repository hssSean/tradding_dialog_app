/** 月相：亮面比例＝精神力（SPEC §3）。右半圓＋橢圓弧，rx = |2k−1|·r */
export default function Moon({ hp }: { hp: number }) {
  const r = 30
  const c = 34
  const k = Math.max(0, Math.min(1, hp / 100))
  const rx = Math.abs(2 * k - 1) * r
  const sweep = k > 0.5 ? 1 : 0
  const lit =
    k >= 0.999
      ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
      : `M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} A ${rx} ${r} 0 0 ${sweep} ${c} ${c - r} Z`
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`精神力 ${hp}，月相盈 ${Math.round(k * 100)}%`}>
      <defs>
        <radialGradient id="moonFill" cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#f6ead0" />
          <stop offset="70%" stopColor="#e9d49e" />
          <stop offset="100%" stopColor="#cdb57c" />
        </radialGradient>
        <filter id="moonGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <circle cx={c} cy={c} r={r} fill="#1d2440" stroke="rgba(233,212,158,0.18)" strokeWidth="1" />
      {k > 0.001 && (
        <>
          <path d={lit} fill="#e9d49e" opacity="0.55" filter="url(#moonGlow)" />
          <path d={lit} fill="url(#moonFill)" />
          <circle cx={c + 9} cy={c - 6} r={4} fill="#cdb57c" opacity="0.35" />
          <circle cx={c + 3} cy={c + 10} r={2.6} fill="#cdb57c" opacity="0.3" />
        </>
      )}
    </svg>
  )
}

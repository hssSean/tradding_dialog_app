import type { AttributeKey } from '../../game/rules'

/** 五軸屬性雷達圖，最弱項用赭色（SPEC §3 #6） */
export default function Radar({ values, weakest }: { values: { key: AttributeKey; value: number }[]; weakest: AttributeKey }) {
  const cx = 180
  const cy = 132
  const R = 92
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / values.length
  const pt = (i: number, r: number) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]
  const poly = (r: number) => values.map((_, i) => pt(i, r).map((n) => n.toFixed(1)).join(',')).join(' ')
  const vals = values.map((s, i) => pt(i, (R * s.value) / 100))
  const weak = values.findIndex((v) => v.key === weakest)
  const labelPos = (i: number) => {
    const [x, y] = pt(i, R + 22)
    const cos = Math.cos(ang(i))
    const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'
    return { x, y: y + 5, anchor }
  }
  return (
    <svg className="radar" viewBox="-24 0 408 262" role="img" aria-label={`角色屬性：${values.map((s) => `${s.key} ${s.value}`).join('、')}`}>
      <g fill="none" stroke="var(--ink-line)" strokeWidth="1">
        {[1, 0.66, 0.33].map((f) => (
          <polygon key={f} points={poly(R * f)} strokeDasharray={f === 1 ? undefined : '2 4'} />
        ))}
        {values.map((_, i) => {
          const [x, y] = pt(i, R)
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} />
        })}
      </g>
      <polygon
        points={vals.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}
        fill="rgba(233,212,158,0.13)"
        stroke="var(--moon)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {vals.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === weak ? 4.5 : 3} fill={i === weak ? 'var(--ochre)' : 'var(--moon)'} />
      ))}
      {values.map((s, i) => {
        const { x, y, anchor } = labelPos(i)
        return (
          <text key={s.key} x={x} y={y} textAnchor={anchor as 'start' | 'middle' | 'end'} className={i === weak ? 'weak' : undefined}>
            {s.key} <tspan className="n">{s.value}</tspan>
          </text>
        )
      })}
    </svg>
  )
}

import { fmtPct, fmtR } from '../lib/format'
import type { GroupRow } from '../lib/stats'
import { rColor } from './ui'

export default function StatsTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-paper">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-paper-dim/60">沒有資料</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-paper-dim">
              <th className="py-1 text-left font-normal">組</th>
              <th className="w-10 text-right font-normal">n</th>
              <th className="w-12 text-right font-normal">勝率</th>
              <th className="w-16 text-right font-normal">平均</th>
              <th className="w-16 text-right font-normal">總 R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`border-t border-ink-line ${r.lowSample ? 'text-paper-dim' : ''}`}>
                <td className="py-1.5">
                  {r.label}
                  {r.lowSample && <span className="ml-1 text-[10px] text-paper-dim/60">樣本太少</span>}
                </td>
                <td className="text-right font-mono">{r.stats.n}</td>
                <td className="text-right font-mono">{fmtPct(r.stats.winRate)}</td>
                <td className={`text-right font-mono ${r.lowSample ? '' : rColor(r.stats.avgR)}`}>{fmtR(r.stats.avgR)}</td>
                <td className={`text-right font-mono ${r.lowSample ? '' : rColor(r.stats.totalR)}`}>{fmtR(r.stats.totalR)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

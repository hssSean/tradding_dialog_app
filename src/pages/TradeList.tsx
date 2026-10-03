import { Link } from 'react-router-dom'
import { LoadError, Loading, PageHeader, rColor } from '../components/ui'
import { fmtDateTime, fmtR } from '../lib/format'
import { enrich } from '../lib/stats'
import { isClosed } from '../lib/trade'
import type { Trade } from '../lib/types'
import { useJournal } from '../lib/useJournal'

function DirBadge({ t }: { t: Trade }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${t.direction === 'long' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
      {t.direction === 'long' ? '多' : '空'}
    </span>
  )
}

export default function TradeList() {
  const { data, error, loading, reload } = useJournal()
  if (loading && !data) return <Loading />
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data) return null

  const open = data.trades.filter((t) => !isClosed(t))
  const closed = enrich(data.trades, data.settings.standard_risk_usdt).sort(
    (a, b) => Date.parse(b.trade.closed_at) - Date.parse(a.trade.closed_at),
  )

  return (
    <>
      <PageHeader title="交易" />

      {open.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-400">未平倉 {open.length}</h2>
          <ul className="space-y-2">
            {open.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-xl border border-sky-900/60 bg-sky-950/30 p-3">
                <Link to={`/trade/${t.id}`} className="flex flex-1 items-center gap-2">
                  <DirBadge t={t} />
                  <span className="font-medium">{t.symbol}</span>
                  <span className="text-xs text-zinc-500">{fmtDateTime(t.opened_at)}</span>
                </Link>
                <Link to={`/trade/${t.id}/close`} className="flex min-h-11 items-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white">
                  平倉
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-2 text-sm font-semibold text-zinc-400">已平倉 {closed.length}</h2>
      {closed.length === 0 ? (
        <p className="py-10 text-center text-zinc-500">還沒有交易。按右下角 ＋ 記錄第一筆。</p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {closed.map((e) => (
            <li key={e.trade.id}>
              <Link to={`/trade/${e.trade.id}`} className="flex min-h-14 items-center gap-2 px-3">
                <DirBadge t={e.trade} />
                <span className="font-medium">{e.trade.symbol}</span>
                {e.keys.length > 0 && <span className="text-xs text-amber-400">⚠ {e.keys.length}</span>}
                <span className="ml-auto text-xs text-zinc-500">{fmtDateTime(e.trade.closed_at)}</span>
                <span className={`w-20 text-right font-mono ${rColor(e.r)}`}>{fmtR(e.r)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/new"
        aria-label="新增交易"
        className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-3xl text-white shadow-lg shadow-black/50"
      >
        ＋
      </Link>
    </>
  )
}

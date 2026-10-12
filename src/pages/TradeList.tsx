import { Link } from 'react-router-dom'
import { TradeRow } from '../components/game'
import { LoadError, Loading } from '../components/ui'
import { fmtDateTime, fmtUsdt } from '../lib/format'
import { useSync } from '../lib/sync'
import { isOpen, isPendingCard } from '../lib/trade'
import type { Trade } from '../lib/types'
import { useJournal } from '../lib/useJournal'

function Side({ t }: { t: Pick<Trade, 'direction'> }) {
  return <span className={`side ${t.direction === 'long' ? 'c-jade' : 'c-ochre'}`}>{t.direction === 'long' ? '多' : '空'}</span>
}

/** 日誌分頁：作戰卡、持倉、已平倉 */
export default function TradeList() {
  const { data, error, loading, reload } = useJournal()
  if (loading && !data) return <Loading />
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data) return null

  const { trades, game, setupNames, pending } = data
  const cards = trades.filter(isPendingCard)
  const open = trades.filter(isOpen).sort((a, b) => Date.parse(b.opened_at!) - Date.parse(a.opened_at!))
  const closed = [...game.timeline.closes].reverse()

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="sec-title" style={{ fontSize: 28 }}>
          日誌
        </h1>
        <div className="flex gap-4 text-sm">
          <Link to="/review" className="text-moon">
            每週檢討
          </Link>
          <Link to="/notes" className="text-moon">
            每日筆記
          </Link>
        </div>
      </header>

      <SyncBar syncedAt={data.settings.bingx_synced_at} />

      {pending.length > 0 && (
        <section id="pending">
          <h2 className="mb-2 font-brush text-lg text-moon">待補資料 · {pending.length}</h2>
          <p className="mb-1 text-xs text-paper-dim">從 BingX 匯入的交易，補上理由（當天補完算有作戰卡）{pending.some((t) => t.planned_stop === null) && '；沒有止損的要補止損才算得出 R'}。</p>
          <div className="trades">
            {pending.map((t) => (
              <Link key={t.id} to={`/trade/${t.id}`} className="trade">
                <div className="trade-mid">
                  <div className="trade-sym">
                    {t.symbol}
                    <Side t={t} />
                  </div>
                  <div className="trade-meta">
                    <span>{fmtDateTime(t.opened_at!)}</span>
                    {t.planned_stop === null && <span className="tag c-ochre">缺止損</span>}
                  </div>
                </div>
                {t.pnl_usdt !== null && <span className={`data text-sm ${t.pnl_usdt > 0 ? 'c-jade' : 'c-ochre'}`}>{fmtUsdt(t.pnl_usdt)}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Link to="/card/new" className="slip" style={{ minHeight: 56 }}>
          <span className="slip-title" style={{ fontSize: 20 }}>
            立作戰卡
          </span>
          <span className="slip-xp">+20</span>
        </Link>
        <Link to="/trade/new" className="flex items-center rounded-sm border border-ink-line px-4 text-sm text-paper-dim">
          補記交易
        </Link>
      </div>

      {cards.length > 0 && (
        <section>
          <h2 className="mb-2 font-brush text-lg">作戰卡 · 待進場</h2>
          <div className="trades">
            {cards.map((t) => (
              <Link key={t.id} to={`/trade/${t.id}`} className="trade">
                <div className="trade-mid">
                  <div className="trade-sym">
                    {t.symbol}
                    <Side t={t} />
                  </div>
                  <div className="trade-meta">
                    <span>
                      計畫 {t.entry_price}／止損 {t.planned_stop}
                    </span>
                    {t.card_at && <span>{fmtDateTime(t.card_at)}</span>}
                  </div>
                </div>
                <span className="text-sm text-moon">已進場 →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {open.length > 0 && (
        <section>
          <h2 className="mb-2 font-brush text-lg">持倉中</h2>
          <div className="trades">
            {open.map((t) => (
              <div key={t.id} className="trade">
                <Link to={`/trade/${t.id}`} className="trade-mid">
                  <div className="trade-sym">
                    {t.symbol}
                    <Side t={t} />
                  </div>
                  <div className="trade-meta">
                    <span>{fmtDateTime(t.opened_at!)}</span>
                    {t.setup_id && <span>{setupNames.get(t.setup_id)}</span>}
                  </div>
                </Link>
                <Link to={`/trade/${t.id}/close`} className="flex min-h-11 items-center rounded-sm bg-moon px-4 text-sm font-medium text-ink">
                  平倉
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-brush text-lg">已平倉 · {closed.length}</h2>
        {closed.length === 0 ? (
          <p className="py-6 text-center text-paper-dim">還沒有平倉的交易。</p>
        ) : (
          <div className="trades">
            {closed.map((e, i) => (
              <TradeRow key={e.trade.id} e={e} index={i} setupName={e.trade.setup_id ? setupNames.get(e.trade.setup_id) : undefined} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** BingX 同步狀態與「立即同步」 */
function SyncBar({ syncedAt }: { syncedAt: string | null }) {
  const { syncing, progress, error, result, syncNow } = useSync()
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between gap-3 text-paper-dim">
        <span>
          {syncing
            ? `BingX 同步中…${progress ? ` ${progress.done}/${progress.total}` : ''}`
            : syncedAt
              ? `BingX 最後同步 ${fmtDateTime(syncedAt)}`
              : 'BingX 尚未同步'}
          {!syncing && result && result.created + result.merged > 0 && `（新增 ${result.created}、對上 ${result.merged}）`}
        </span>
        <button type="button" className="min-h-10 px-2 text-moon disabled:opacity-40" onClick={syncNow} disabled={syncing}>
          立即同步
        </button>
      </div>
      {error && <p className="text-ochre">{error}</p>}
    </div>
  )
}

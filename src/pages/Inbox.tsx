import { Link } from 'react-router-dom'
import QuickTagCard from '../components/QuickTagCard'
import { LoadError, Loading, PageHeader } from '../components/ui'
import { fetchOpenPositions, tagOpenPosition, tagTrade } from '../lib/db'
import { needsTag, openPositionTrade, untaggedOpen } from '../lib/quickTag'
import { openEvents } from '../notify/events'
import { useAsync } from '../lib/useAsync'
import { useJournal } from '../lib/useJournal'
import type { RawTrade } from '../lib/types'

type Item = { kind: 'open'; trade: RawTrade; pos: Parameters<typeof tagOpenPosition>[0] } | { kind: 'trade'; trade: RawTrade }

/** 收件匣：BingX 持倉中還沒標的＋最近 7 天沒標完的交易，一張一張標，標完自動下一張 */
export default function Inbox() {
  const journal = useJournal()
  // 持倉讀不到（BingX 掛掉）不擋收件匣，只是少了持倉那幾筆
  const open = useAsync(() => fetchOpenPositions().catch(() => null), [])

  if (journal.error) return <main className="page"><LoadError error={journal.error} onRetry={journal.reload} /></main>
  if (!journal.data || open.loading) return <main className="page"><Loading /></main>
  const { raw, setups } = journal.data

  const now = Date.now()
  const items: Item[] = [
    ...openEvents(untaggedOpen(open.data ?? [], raw), new Set(), now).flatMap((e) =>
      e.kind === 'open' ? [{ kind: 'open' as const, pos: e, trade: openPositionTrade(e) }] : [],
    ),
    ...raw
      .filter((t) => needsTag(t, now))
      .sort((a, b) => Date.parse(b.closed_at ?? b.opened_at!) - Date.parse(a.closed_at ?? a.opened_at!))
      .map((trade) => ({ kind: 'trade' as const, trade })),
  ]

  const reloadAll = () => {
    journal.reload()
    open.reload()
  }

  const item = items[0]
  return (
    <main className="page px-[18px] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <PageHeader title="待標記" right={<span className="text-sm text-paper-dim">{items.length} 筆</span>} />
      {open.data === null && <p className="mb-3 text-xs text-paper-dim">讀不到 BingX 持倉，先列日誌裡的。</p>}
      {!item ? (
        <div className="space-y-3 py-10 text-center">
          <p className="font-brush text-xl text-jade">都標完了</p>
          <Link to="/" className="text-moon">
            回首頁 →
          </Link>
        </div>
      ) : item.kind === 'open' ? (
        <QuickTagCard
          key={item.trade.id}
          trade={item.trade}
          setups={setups}
          showOpen
          showClose={false}
          onSubmit={async (o) => {
            if (o) await tagOpenPosition(item.pos, o)
            reloadAll()
          }}
        />
      ) : (
        <QuickTagCard
          key={item.trade.id}
          trade={item.trade}
          setups={setups}
          showOpen={item.trade.card_at === null}
          showClose={item.trade.closed_at !== null}
          onSubmit={async (o, c) => {
            await tagTrade(item.trade, c, o)
            reloadAll()
          }}
        />
      )}
    </main>
  )
}

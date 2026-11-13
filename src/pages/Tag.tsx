import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import QuickTagCard from '../components/QuickTagCard'
import { LoadError, Loading } from '../components/ui'
import { tagOpenPosition, tagTrade } from '../lib/db'
import { openPositionTrade, openPosFromQuery } from '../lib/quickTag'
import { useSync } from '../lib/sync'
import { useJournal } from '../lib/useJournal'

/**
 * 推播落地頁：/tag/open/:pid?s=&d=&p=&t=（開倉）、/tag/close/:pid（平倉）。
 * 平倉的交易要同步過才在日誌裡：找不到就同步一次，還是找不到就轉到收件匣。
 */
export default function Tag() {
  const { kind, pid = '' } = useParams()
  const [query] = useSearchParams()
  const navigate = useNavigate()
  const { data, error, reload } = useJournal()
  const { syncing, syncNow } = useSync()
  const [triedSync, setTriedSync] = useState(false)

  const existing = data?.raw.find((t) => t.external_id === pid)
  const needSync = kind === 'close' && data !== undefined && !existing

  useEffect(() => {
    if (needSync && !triedSync) {
      setTriedSync(true)
      syncNow()
    }
  }, [needSync, triedSync, syncNow])

  const wrap = (body: React.ReactNode) => <main className="page px-[18px] pt-[calc(env(safe-area-inset-top)+1.5rem)]">{body}</main>

  if (error) return wrap(<LoadError error={error} onRetry={reload} />)
  if (!data) return wrap(<Loading />)
  const done = () => navigate('/inbox', { replace: true })

  if (existing) {
    const closed = existing.closed_at !== null
    return wrap(
      <QuickTagCard
        key={existing.id}
        trade={existing}
        setups={data.setups}
        showOpen={!closed || existing.card_at === null}
        showClose={closed}
        onSubmit={async (open, close) => {
          await tagTrade(existing, close, open)
          done()
        }}
      />,
    )
  }

  if (kind === 'open') {
    const pos = openPosFromQuery(pid, query)
    if (pos) {
      return wrap(
        <QuickTagCard
          trade={openPositionTrade(pos)}
          setups={data.setups}
          showOpen
          showClose={false}
          onSubmit={async (open) => {
            if (open) await tagOpenPosition(pos, open)
            done()
          }}
        />,
      )
    }
  }

  if (needSync && (syncing || !triedSync)) return wrap(<p className="py-10 text-center text-paper-dim">同步 BingX 中…</p>)
  return wrap(
    <div className="space-y-3 py-10 text-center">
      <p className="text-paper-dim">日誌裡還找不到這筆（BingX 可能還沒更新）。</p>
      <Link to="/inbox" className="text-moon">
        到收件匣 →
      </Link>
    </div>,
  )
}

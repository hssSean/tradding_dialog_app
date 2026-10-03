import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import StatsTable from '../components/StatsTable'
import { Card, LoadError, Loading, Segmented, inputClass, rColor } from '../components/ui'
import { getWeeklyReview, saveWeeklyReview } from '../lib/db'
import { fmtPct, fmtR, fmtUsdt, weekTitle } from '../lib/format'
import {
  type Dimension,
  type Scope,
  addWeeks,
  biggestProblem,
  cleanVsFlagged,
  enrich,
  groupBy,
  inScope,
  weekStartOf,
  weekSummary,
} from '../lib/stats'
import { useAsync } from '../lib/useAsync'
import { useJournal } from '../lib/useJournal'

const DIMENSIONS: { dim: Dimension; title: string }[] = [
  { dim: 'discipline', title: '紀律' },
  { dim: 'setup', title: 'Setup' },
  { dim: 'symbol', title: '幣種' },
  { dim: 'direction', title: '方向' },
  { dim: 'hour', title: '時段（進場，台北時間）' },
  { dim: 'weekday', title: '星期（進場）' },
]

const DIMENSION_NAMES: Record<Dimension, string> = {
  discipline: '紀律',
  setup: 'Setup',
  symbol: '幣種',
  direction: '方向',
  hour: '時段',
  weekday: '星期',
}

function Delta({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-xs text-zinc-500">
      {label} <span className={rColor(value)}>{fmtR(value)}</span>
    </span>
  )
}

export default function WeeklyReview() {
  const params = useParams()
  const thisWeek = weekStartOf(new Date())
  const week = params.week ?? thisWeek
  const [scope, setScope] = useState<Scope>('week')
  const journal = useJournal()

  if (journal.error) return <LoadError error={journal.error} onRetry={journal.reload} />
  if (!journal.data) return <Loading />
  const { trades, settings, setupNames } = journal.data

  const all = enrich(trades, settings.standard_risk_usdt)
  const weekList = inScope(all, 'week', week)
  const summary = weekSummary(all, week)
  const problem = biggestProblem(weekList, setupNames)
  const split = cleanVsFlagged(weekList)
  const scoped = inScope(all, scope, week)
  const s = summary.current

  return (
    <>
      <header className="mb-4 flex items-center justify-between">
        <Link to={`/review/${addWeeks(week, -1)}`} className="flex min-h-11 min-w-11 items-center justify-center text-2xl text-sky-400" aria-label="上一週">
          ‹
        </Link>
        <div className="text-center">
          <h1 className="text-xl font-bold">{weekTitle(week)}</h1>
          {week === thisWeek && <p className="text-xs text-zinc-500">本週</p>}
        </div>
        {week < thisWeek ? (
          <Link to={`/review/${addWeeks(week, 1)}`} className="flex min-h-11 min-w-11 items-center justify-center text-2xl text-sky-400" aria-label="下一週">
            ›
          </Link>
        ) : (
          <span className="min-w-11" />
        )}
      </header>

      <div className="space-y-4">
        <Card>
          {s.n === 0 ? (
            <p className="text-center text-zinc-500">這週沒有平倉的交易</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <p className={`font-mono text-3xl ${rColor(s.totalR)}`}>{fmtR(s.totalR)}</p>
                <p className={`font-mono ${rColor(s.pnl)}`}>{fmtUsdt(s.pnl)} USDT</p>
              </div>
              <div className="mt-2 grid grid-cols-3 text-sm">
                <span>
                  <span className="text-zinc-500">筆數 </span>
                  {s.n}
                </span>
                <span>
                  <span className="text-zinc-500">勝率 </span>
                  {fmtPct(s.winRate)}
                </span>
                <span>
                  <span className="text-zinc-500">平均 </span>
                  {fmtR(s.avgR)}
                </span>
              </div>
            </>
          )}
          <div className="mt-2 flex gap-4">
            <Delta label="上週" value={summary.prevTotalR} />
            <Delta label="前 4 週平均" value={summary.avg4TotalR} />
          </div>
        </Card>

        <Card title="本週最大問題" className={problem ? 'border-red-900/70' : ''}>
          {problem ? (
            <>
              <p className="text-lg font-semibold">
                <span className="mr-2 text-xs text-zinc-500">{DIMENSION_NAMES[problem.dimension]}</span>
                {problem.label}
              </p>
              <p className="mt-1 text-sm text-zinc-300">
                {problem.n} 筆，共 <span className="text-red-400">{fmtR(problem.totalR)}</span>，佔本週虧損 {fmtPct(problem.share)}
              </p>
            </>
          ) : (
            <p className="text-zinc-500">本週沒有虧損來源</p>
          )}
        </Card>

        {s.n > 0 && (
          <Card title="乾淨 vs 犯錯">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-zinc-500">乾淨單 {split.clean.n} 筆</p>
                <p className={`font-mono text-lg ${rColor(split.clean.totalR)}`}>{fmtR(split.clean.totalR)}</p>
              </div>
              <div>
                <p className="text-zinc-500">犯錯單 {split.flagged.n} 筆</p>
                <p className={`font-mono text-lg ${rColor(split.flagged.totalR)}`}>{fmtR(split.flagged.totalR)}</p>
              </div>
            </div>
            {split.flagged.n > 0 && (
              <p className="mt-2 text-sm text-zinc-400">若沒有犯錯單，本週總 R 為 {fmtR(split.clean.totalR)}</p>
            )}
          </Card>
        )}

        <Card title="分組">
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'week', label: '本週' },
              { value: '4w', label: '近 4 週' },
              { value: 'all', label: '全部' },
            ]}
          />
          <p className="mt-2 text-xs text-zinc-600">共 {scoped.length} 筆。n &lt; 5 的組灰字，不要拿來下結論。</p>
          <div className="mt-3 space-y-5">
            {DIMENSIONS.map(({ dim, title }) => (
              <StatsTable key={dim} title={title} rows={groupBy(scoped, dim, setupNames)} />
            ))}
          </div>
        </Card>

        <ReviewNotes week={week} />
      </div>
    </>
  )
}

function ReviewNotes({ week }: { week: string }) {
  const prev = useAsync(() => getWeeklyReview(addWeeks(week, -1)), [week])
  const current = useAsync(() => getWeeklyReview(week), [week])
  const [note, setNote] = useState('')
  const [focus, setFocus] = useState('')
  const [status, setStatus] = useState<string>()

  useEffect(() => {
    if (current.loading) return
    setNote(current.data?.note ?? '')
    setFocus(current.data?.next_week_focus ?? '')
  }, [current.data, current.loading])

  async function save() {
    setStatus('儲存中…')
    try {
      await saveWeeklyReview(week, note, focus)
      setStatus('已儲存')
    } catch (e) {
      setStatus(`儲存失敗：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Card title="本週心得">
      {prev.data?.next_week_focus && (
        <div className="mb-3 rounded-lg bg-sky-950/40 p-3 text-sm">
          <p className="mb-1 text-xs text-sky-400">上週說這週要改的事</p>
          <p className="whitespace-pre-wrap text-zinc-200">{prev.data.next_week_focus}</p>
        </div>
      )}
      {current.error ? (
        <LoadError error={current.error} onRetry={current.reload} />
      ) : current.loading ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          <textarea className={`${inputClass} min-h-24`} placeholder="這週發生了什麼" value={note} onChange={(e) => setNote(e.target.value)} onBlur={save} />
          <textarea
            className={`${inputClass} min-h-20`}
            placeholder="下週要改的事"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onBlur={save}
          />
          {status && <p className="text-xs text-zinc-500">{status}</p>}
        </div>
      )}
    </Card>
  )
}

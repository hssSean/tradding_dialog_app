import { Suspense, lazy, useState } from 'react'
import type { CloseTagInput, OpenTagInput } from '../lib/quickTag'
import { DIRECTION_LABELS } from '../lib/trade'
import type { RawTrade, Setup } from '../lib/types'
import { Button, Errors, Segmented, inputClass } from './ui'

const LazyChart = lazy(() => import('./TradeChart'))

const OTHER = '__other'

/**
 * 快速標記卡（推播落地頁與收件匣共用）：setup 必點，其他列有預設，最少兩下。
 * showOpen：顯示開倉三列（開倉卡，或平倉時開倉還沒標過）。showClose：顯示平倉列。
 */
export default function QuickTagCard({
  trade,
  setups,
  showOpen,
  showClose,
  onSubmit,
}: {
  trade: RawTrade
  setups: Setup[]
  showOpen: boolean
  showClose: boolean
  onSubmit: (open: OpenTagInput | null, close: CloseTagInput | null) => Promise<void>
}) {
  const [setup, setSetup] = useState<string | undefined>(trade.setup_id ?? (trade.card_at ? OTHER : undefined))
  const [planned, setPlanned] = useState<'yes' | 'no'>(trade.mistake_tags.includes('unplanned') ? 'no' : 'yes')
  const [reason, setReason] = useState('')
  const [exit, setExit] = useState<CloseTagInput['exit']>(
    trade.mistake_tags.includes('early_exit') ? 'early' : trade.mistake_tags.includes('late_exit') ? 'late' : 'plan',
  )
  const [chased, setChased] = useState<'no' | 'yes'>(trade.mistake_tags.includes('chasing') ? 'yes' : 'no')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const active = setups.filter((s) => !s.archived || s.id === trade.setup_id)
  const ready = !showOpen || setup !== undefined

  async function submit() {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      await onSubmit(
        showOpen ? { setup_id: setup === OTHER ? null : (setup ?? null), planned: planned === 'yes', reason } : null,
        showClose ? { exit, chased: chased === 'yes', note } : null,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="font-brush text-2xl text-moon">
          {trade.symbol} · 做{DIRECTION_LABELS[trade.direction]}
        </h1>
        <p className="text-xs text-paper-dim">{showClose ? '已平倉' : '持倉中'} · 進場 {trade.entry_price}</p>
      </header>

      {trade.opened_at && (
        <div className="overflow-hidden rounded-lg border border-ink-line">
          <Suspense fallback={<p className="py-10 text-center text-sm text-paper-dim">載入 K 線…</p>}>
            <LazyChart trade={trade} />
          </Suspense>
        </div>
      )}

      {showOpen && (
        <>
          <div>
            <p className="mb-1 text-sm text-paper-dim">什麼 setup？</p>
            <div className="flex flex-wrap gap-2">
              {[...active.map((s) => ({ id: s.id, name: s.name })), { id: OTHER, name: '其他' }].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSetup(s.id)}
                  className={`min-h-11 rounded-lg px-4 text-sm ${setup === s.id ? 'bg-moon text-ink' : 'bg-paper/10 text-paper'}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm text-paper-dim">照計畫進場嗎？</p>
            <Segmented
              value={planned}
              onChange={setPlanned}
              options={[
                { value: 'yes', label: '照計畫' },
                { value: 'no', label: '臨時起意' },
              ]}
            />
          </div>
          <input className={inputClass} placeholder="一句話（選填，可用語音）" value={reason} onChange={(e) => setReason(e.target.value)} enterKeyHint="done" />
        </>
      )}

      {showClose && (
        <>
          <div>
            <p className="mb-1 text-sm text-paper-dim">照計畫出場嗎？</p>
            <Segmented
              value={exit}
              onChange={setExit}
              options={[
                { value: 'plan', label: '照計畫' },
                { value: 'early', label: '提前跑' },
                { value: 'late', label: '抱太久' },
              ]}
            />
          </div>
          {showOpen && (
            <div>
              <p className="mb-1 text-sm text-paper-dim">追價了嗎？</p>
              <Segmented
                value={chased}
                onChange={setChased}
                options={[
                  { value: 'no', label: '沒有' },
                  { value: 'yes', label: '有' },
                ]}
              />
            </div>
          )}
          <input className={inputClass} placeholder="檢討一句話（選填）" value={note} onChange={(e) => setNote(e.target.value)} enterKeyHint="done" />
        </>
      )}

      {error && <Errors errors={[error]} />}
      <Button className="w-full" disabled={!ready || busy} onClick={() => void submit()}>
        {busy ? '儲存中…' : ready ? '完成' : '先選 setup'}
      </Button>
    </section>
  )
}

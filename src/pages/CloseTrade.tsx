import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import DraftBanner from '../components/DraftBanner'
import ExitFields from '../components/ExitFields'
import ImagePicker from '../components/ImagePicker'
import { Button, Card, Errors, LoadError, Loading, PageHeader, rColor } from '../components/ui'
import { closeTrade, uploadImage } from '../lib/db'
import { fmtR, toLocalInput } from '../lib/format'
import { type ExitForm, emptyExitForm, parseExit } from '../lib/forms'
import { currentStop, isAgainstMove, isClosed, isOpen, rMultiple } from '../lib/trade'
import type { ClosedTrade, Trade } from '../lib/types'
import { useDraftForm } from '../lib/useDraft'
import { useJournal } from '../lib/useJournal'

export default function CloseTrade() {
  const { id } = useParams()
  const { data, error, reload } = useJournal()
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data) return <Loading />
  const trade = data.trades.find((t) => t.id === id)
  if (!trade) return <p className="py-10 text-center text-paper-dim">找不到這筆交易</p>
  if (isClosed(trade)) return <Navigate to={`/trade/${trade.id}/edit`} replace />
  if (!isOpen(trade)) return <Navigate to={`/trade/${trade.id}`} replace />
  return <CloseForm trade={trade} />
}

function CloseForm({ trade }: { trade: Trade }) {
  const navigate = useNavigate()
  const draft = useDraftForm<ExitForm>(`draft:close:${trade.id}`, emptyExitForm(trade, toLocalInput(new Date().toISOString())))
  const [image, setImage] = useState<Blob | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // 送出前預覽 R 與自動警示
  const parsed = parseExit(draft.form, trade)
  const preview: ClosedTrade | null = parsed.errors.length ? null : ({ ...trade, ...parsed.value } as ClosedTrade)

  async function submit() {
    setErrors(parsed.errors)
    if (parsed.errors.length) return
    setBusy(true)
    try {
      await closeTrade(trade, parsed.value)
      draft.clear()
      if (image) await uploadImage(trade.id, 'exit', image).catch(() => undefined)
      navigate(`/trade/${trade.id}`, { replace: true })
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)])
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={`平倉 ${trade.symbol}`} right={<Button variant="secondary" onClick={() => navigate(-1)}>取消</Button>} />
      {draft.pending && <DraftBanner onRestore={draft.restore} onDiscard={draft.discard} />}
      <p className="mb-4 text-sm text-paper-dim">
        做{trade.direction === 'long' ? '多' : '空'} 進場 {trade.entry_price}　目前止損 {currentStop(trade)}
        {trade.planned_target !== null && `　目標 ${trade.planned_target}`}
      </p>
      <div className="space-y-4">
        <ExitFields value={draft.form} onChange={draft.setForm} />
        <ImagePicker label="出場截圖" value={image} onChange={setImage} />
        {preview && <PreviewCard t={preview} from={currentStop(trade)} />}
        <Errors errors={errors} />
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? '儲存中…' : '儲存平倉'}
        </Button>
      </div>
    </>
  )
}

function PreviewCard({ t, from }: { t: ClosedTrade; from: number }) {
  const r = rMultiple(t)
  const against = t.final_stop !== null && t.final_stop !== from && isAgainstMove(t.direction, from, t.final_stop)
  return (
    <Card title="預覽">
      <p className={`data text-2xl ${rColor(r)}`}>{fmtR(r)}</p>
      {against && <p className="mt-2 text-sm text-ochre">最後止損比目前止損更不利，會記為逆向移動止損。</p>}
      <p className="mt-2 text-sm text-paper-dim">{t.note ? '有寫復盤，存檔就算完成復盤 +20。' : '還沒寫復盤；24 小時內補寫也算。'}</p>
    </Card>
  )
}

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ImagePicker from '../components/ImagePicker'
import { Button, Card, LoadError, Loading, PageHeader, rColor } from '../components/ui'
import { deleteTrade, imageUrl, listImages, uploadImage } from '../lib/db'
import { fmtDateTime, fmtR, fmtUsdt } from '../lib/format'
import { enrich } from '../lib/stats'
import { EXIT_REASON_LABELS, isClosed, plannedRR, tagLabel } from '../lib/trade'
import type { ImageKind, TradeImage } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { useJournal } from '../lib/useJournal'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

export default function TradeDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const journal = useJournal()
  const images = useAsync(async () => {
    const list = await listImages(id)
    return Promise.all(list.map(async (img) => ({ ...img, url: await imageUrl(img.path) })))
  }, [id])
  const [deleting, setDeleting] = useState(false)

  if (journal.error) return <LoadError error={journal.error} onRetry={journal.reload} />
  if (!journal.data) return <Loading />
  const { trades, settings, setupNames } = journal.data
  const t = trades.find((x) => x.id === id)
  if (!t) return <p className="py-10 text-center text-zinc-500">找不到這筆交易</p>

  const e = isClosed(t) ? enrich(trades, settings.standard_risk_usdt).find((x) => x.trade.id === id) : undefined
  const rr = plannedRR(t)

  async function remove() {
    if (!confirm('確定刪除這筆交易？截圖也會一起刪除，無法復原。')) return
    setDeleting(true)
    try {
      await deleteTrade(id)
      navigate('/', { replace: true })
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title={`${t.symbol} 做${t.direction === 'long' ? '多' : '空'}`}
        right={
          <Link to="/" className="flex min-h-11 items-center px-2 text-sky-400">
            返回
          </Link>
        }
      />

      <div className="space-y-4">
        {e ? (
          <Card>
            <p className={`font-mono text-3xl ${rColor(e.r)}`}>{fmtR(e.r)}</p>
            <p className="mt-1 text-sm text-zinc-400">
              {fmtUsdt(e.pnl)} USDT{e.pnlEstimated && <span className="text-zinc-600">（估算）</span>}
            </p>
            {e.keys.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {e.keys.map((k) => (
                  <span key={k} className="rounded-full bg-amber-900/60 px-2.5 py-1 text-xs text-amber-300">
                    {tagLabel(k)}
                  </span>
                ))}
              </div>
            )}
          </Card>
        ) : (
          <Link to={`/trade/${id}/close`} className="flex min-h-12 items-center justify-center rounded-lg bg-sky-600 font-medium text-white">
            平倉
          </Link>
        )}

        <Card title="計畫">
          <Row label="進場時間">{fmtDateTime(t.opened_at)}</Row>
          <Row label="Setup">{t.setup_id ? (setupNames.get(t.setup_id) ?? '未分類') : '未分類'}</Row>
          {t.timeframe && <Row label="時間框架">{t.timeframe}</Row>}
          <Row label="進場價">{t.entry_price}</Row>
          <Row label="計畫止損">{t.planned_stop}</Row>
          {t.planned_target !== null && <Row label="目標">{t.planned_target}</Row>}
          {rr !== null && <Row label="計畫 R:R">{rr}</Row>}
          <Row label="風險金額">{t.risk_usdt} USDT</Row>
          {t.entry_reason && <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-300">{t.entry_reason}</p>}
        </Card>

        {isClosed(t) && (
          <Card title="結果">
            <Row label="出場時間">{fmtDateTime(t.closed_at)}</Row>
            <Row label="出場價">{t.exit_price}</Row>
            <Row label="最後止損">{t.final_stop ?? t.planned_stop}</Row>
            <Row label="出場原因">{EXIT_REASON_LABELS[t.exit_reason]}</Row>
            {t.note && <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-300">{t.note}</p>}
          </Card>
        )}

        <Card title="截圖">
          {images.error ? (
            <LoadError error={images.error} onRetry={images.reload} />
          ) : images.loading && !images.data ? (
            <Loading />
          ) : (
            <div className="space-y-4">
              <ImageSlot kind="entry" label="進場" tradeId={id} images={images.data ?? []} onUploaded={images.reload} />
              {isClosed(t) && <ImageSlot kind="exit" label="出場" tradeId={id} images={images.data ?? []} onUploaded={images.reload} />}
            </div>
          )}
        </Card>

        <div className="flex gap-3">
          <Link to={`/trade/${id}/edit`} className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-zinc-800 font-medium">
            編輯
          </Link>
          <Button variant="danger" className="flex-1" onClick={remove} disabled={deleting}>
            {deleting ? '刪除中…' : '刪除'}
          </Button>
        </div>
      </div>
    </>
  )
}

function ImageSlot({
  kind,
  label,
  tradeId,
  images,
  onUploaded,
}: {
  kind: ImageKind
  label: string
  tradeId: string
  images: (TradeImage & { url: string })[]
  onUploaded: () => void
}) {
  const img = images.find((i) => i.kind === kind)
  const [full, setFull] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function upload() {
    if (!blob) return
    setBusy(true)
    setError(undefined)
    try {
      await uploadImage(tradeId, kind, blob)
      setBlob(null)
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (img)
    return (
      <div>
        <span className="mb-1 block text-sm text-zinc-400">{label}</span>
        <button type="button" className="block w-full" onClick={() => setFull(true)}>
          <img src={img.url} alt={`${label}截圖`} className="max-h-72 w-full rounded-lg bg-black object-contain" />
        </button>
        {full && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={() => setFull(false)}>
            <img src={img.url} alt={`${label}截圖`} className="max-h-full max-w-full object-contain" />
          </div>
        )}
      </div>
    )

  return (
    <div className="space-y-2">
      <ImagePicker label={`${label}（未上傳）`} value={blob} onChange={setBlob} />
      {blob && (
        <Button className="w-full" onClick={upload} disabled={busy}>
          {busy ? '上傳中…' : '上傳截圖'}
        </Button>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

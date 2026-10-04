import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmotionPicker, GradeSeal, QuadrantTag, WarnIcon } from '../components/game'
import ImagePicker from '../components/ImagePicker'
import { Button, Card, Errors, Field, LoadError, Loading, PageHeader, inputClass, rColor } from '../components/ui'
import type { TradeEval } from '../game/evaluate'
import { VIOLATION_LABELS, type ScoreItem } from '../game/rules'
import {
  abandonCard,
  deleteTrade,
  fillCardLate,
  imageUrl,
  listImages,
  markEntered,
  moveStop,
  saveCaption,
  saveReview,
  uploadImage,
} from '../lib/db'
import { fmtDateTime, fmtR, fmtUsdt, fromLocalInput, parseNum, toLocalInput } from '../lib/format'
import { EXIT_REASON_LABELS, currentStop, isAgainstMove, isClosed, isPendingCard, plannedRR, riskPct, tagLabel } from '../lib/trade'
import type { ImageKind, Trade, TradeImage } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { useJournal } from '../lib/useJournal'

const ITEM_LABELS: Record<ScoreItem, string> = {
  card: '進場前有作戰卡',
  stop: '有初始止損',
  risk: '風險在上限內',
  stopMove: '沒有逆向移動止損',
  review: '及時復盤',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-paper-dim">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function TradeDetail() {
  const { id = '' } = useParams()
  const journal = useJournal([id])
  if (journal.error) return <LoadError error={journal.error} onRetry={journal.reload} />
  if (!journal.data) return <Loading />
  const { trades, setupNames, game } = journal.data
  const t = trades.find((x) => x.id === id)
  if (!t) return <p className="py-10 text-center text-paper-dim">找不到這筆交易</p>
  return (
    <Detail
      t={t}
      e={game.timeline.byId.get(id)}
      setupName={t.setup_id ? (setupNames.get(t.setup_id) ?? '未分類') : '未分類'}
      cooldownEndsAt={game.debuffs.find((d) => d.kind === 'cooldown')?.endsAt ?? null}
      reload={journal.reload}
    />
  )
}

function Detail({
  t,
  e,
  setupName,
  cooldownEndsAt,
  reload,
}: {
  t: Trade
  e: TradeEval | undefined
  setupName: string
  cooldownEndsAt: string | null
  reload: () => void
}) {
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const rr = plannedRR(t)
  const rp = riskPct(t)
  const pending = isPendingCard(t)
  const closed = isClosed(t)

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setErrors([])
    try {
      await fn()
      if (after) after()
      else reload()
    } catch (err) {
      setErrors([errMsg(err)])
    }
  }

  const status = t.abandoned_at ? '已放棄' : pending ? '作戰卡' : closed ? '已平倉' : '持倉中'

  return (
    <>
      <PageHeader
        title={`${t.symbol} 做${t.direction === 'long' ? '多' : '空'}`}
        right={
          <Link to="/log" className="flex min-h-11 items-center px-2 text-moon">
            返回
          </Link>
        }
      />
      <p className="-mt-2 mb-4 text-sm text-paper-dim">
        {status} · {setupName}
      </p>

      <div className="space-y-4">
        <Errors errors={errors} />

        {closed && e && <ResultCard e={e} />}

        {pending && <EnterCard t={t} cooldownEndsAt={cooldownEndsAt} onDone={reload} onAbandon={() => run(() => abandonCard(t.id))} />}

        {!pending && !closed && !t.abandoned_at && (
          <>
            <Link to={`/trade/${t.id}/close`} className="slip">
              <span className="slip-title">平倉</span>
              <span className="slip-sub">平倉時寫復盤，24 小時內 +20</span>
            </Link>
            <MoveStopCard t={t} onDone={reload} />
          </>
        )}

        {!pending && !t.abandoned_at && t.card_at === null && t.gamified && <LateCardForm t={t} onDone={reload} />}

        <Card title="計畫">
          {t.opened_at && <Row label="進場時間">{fmtDateTime(t.opened_at)}</Row>}
          {t.card_at && (
            <Row label="作戰卡">
              {fmtDateTime(t.card_at)}
              {e && (e.cardBefore ? '（進場前）' : '（進場後補）')}
            </Row>
          )}
          {t.timeframe && <Row label="時間框架">{t.timeframe}</Row>}
          <Row label={pending ? '計畫進場價' : '進場價'}>{t.entry_price}</Row>
          <Row label="初始止損">{t.planned_stop}</Row>
          {t.planned_target !== null && <Row label="目標">{t.planned_target}</Row>}
          {rr !== null && <Row label="計畫 R:R">{rr}</Row>}
          <Row label="風險">
            {t.risk_usdt} USDT{rp !== null && <span className="data">（{rp.toFixed(2)}%）</span>}
          </Row>
          {t.emotion !== null && <Row label="情緒">{t.emotion}</Row>}
          {t.entry_reason && <p className="mt-2 text-sm whitespace-pre-wrap text-paper">{t.entry_reason}</p>}
          {t.stop_edits.length > 0 && (
            <div className="mt-3 border-t border-ink-line pt-2">
              <p className="mb-1 text-xs text-paper-dim">止損移動</p>
              {t.stop_edits.map((s, i) => (
                <p key={i} className={`data text-xs ${isAgainstMove(t.direction, s.from, s.to) ? 'text-ochre' : 'text-paper-dim'}`}>
                  {fmtDateTime(s.at)}　{s.from} → {s.to}
                  {isAgainstMove(t.direction, s.from, s.to) && '　逆向'}
                </p>
              ))}
            </div>
          )}
        </Card>

        {closed && (
          <Card title="結果">
            <Row label="出場時間">{fmtDateTime(t.closed_at!)}</Row>
            <Row label="出場價">{t.exit_price}</Row>
            <Row label="最後止損">{currentStop(t)}</Row>
            <Row label="出場原因">{EXIT_REASON_LABELS[t.exit_reason!]}</Row>
            {t.mistake_tags.length > 0 && <Row label="自評">{t.mistake_tags.map(tagLabel).join('、')}</Row>}
          </Card>
        )}

        {closed && <ReviewCard t={t} onDone={reload} />}

        {!t.abandoned_at && <ImagesCard t={t} />}

        <div className="flex gap-3">
          <Link to={`/trade/${t.id}/edit`} className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-paper/10 font-medium">
            編輯
          </Link>
          <Button variant="danger" className="flex-1" onClick={() => setConfirmDelete(true)}>
            刪除
          </Button>
        </div>
        {confirmDelete && (
          <div className="space-y-3 rounded-md border border-ochre/50 bg-ochre/10 p-3 text-sm">
            <p>確定刪除這筆交易？截圖也會一起刪除，無法復原。</p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
                取消
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => run(() => deleteTrade(t.id), () => navigate('/log', { replace: true }))}>
                確定刪除
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/** 已平倉：R、損益、評級、評分明細、違規 */
function ResultCard({ e }: { e: TradeEval }) {
  const r = e.r ?? 0
  return (
    <Card>
      <div className="flex items-center gap-4">
        <GradeSeal grade={e.grade} />
        <div className="flex-1">
          <p className={`data text-3xl ${rColor(r)}`}>{fmtR(r)}</p>
          <p className="text-sm text-paper-dim">{e.pnl !== null && `${fmtUsdt(e.pnl)} USDT`}</p>
        </div>
        {e.quadrant && <QuadrantTag quadrant={e.quadrant} />}
      </div>
      {e.quadrant === 'lucky_bad' && e.mainViolation && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-moon">
          {WarnIcon}
          {e.mainViolation}
        </p>
      )}
      {e.items ? (
        <div className="mt-3 border-t border-ink-line pt-2">
          <div className="flex justify-between text-sm">
            <span className="text-paper-dim">評分{e.provisional && '（暫定，還沒復盤）'}</span>
            <span className="data text-moon">{e.score}</span>
          </div>
          {(Object.keys(ITEM_LABELS) as ScoreItem[]).map((k) => (
            <div key={k} className="flex justify-between text-xs">
              <span className={e.items![k] < 20 ? 'text-ochre' : 'text-paper-dim'}>{ITEM_LABELS[k]}</span>
              <span className="data">{e.items![k]} / 20</span>
            </div>
          ))}
          {e.violations.includes('tilt') && <p className="mt-1 text-xs text-ochre">冷卻期間開單：分數上限 74</p>}
          {e.hpAtOpen === 0 && <p className="mt-1 text-xs text-ochre">精神力歸零後開單：評級降一級</p>}
        </div>
      ) : (
        <p className="mt-3 text-sm text-paper-dim">v2 之前的紀錄，資料不足，不評分。</p>
      )}
      {e.violations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {e.violations.map((v) => (
            <span key={v} className="tag c-ochre">
              {VIOLATION_LABELS[v]}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

/** 作戰卡 → 已進場／放棄 */
function EnterCard({
  t,
  cooldownEndsAt,
  onDone,
  onAbandon,
}: {
  t: Trade
  cooldownEndsAt: string | null
  onDone: () => void
  onAbandon: () => void
}) {
  const [price, setPrice] = useState(String(t.entry_price))
  const [at, setAt] = useState(() => toLocalInput(new Date().toISOString()))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const cooling = cooldownEndsAt !== null && Date.parse(cooldownEndsAt) > Date.parse(fromLocalInput(at))

  async function enter() {
    const p = parseNum(price)
    if (p === null || !(p > 0)) return setErrors(['成交價要是大於 0 的數字'])
    const openedAt = fromLocalInput(at)
    if (t.card_at && Date.parse(openedAt) <= Date.parse(t.card_at)) return setErrors(['進場時間要晚於作戰卡存檔時間'])
    setBusy(true)
    try {
      await markEntered(t, openedAt, p)
      onDone()
    } catch (e) {
      setErrors([errMsg(e)])
      setBusy(false)
    }
  }

  return (
    <Card title="已進場？">
      <div className="space-y-3">
        {cooling && <p className="text-sm text-ochre">上頭冷卻中，現在進場會記為上頭違規（評分上限 B、倉位降一階）。</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="成交價">
            <input className={inputClass} inputMode="decimal" value={price} onChange={(ev) => setPrice(ev.target.value)} />
          </Field>
          <Field label="進場時間">
            <input className={inputClass} type="datetime-local" value={at} onChange={(ev) => setAt(ev.target.value)} />
          </Field>
        </div>
        <Errors errors={errors} />
        <Button className="w-full" onClick={enter} disabled={busy}>
          {busy ? '儲存中…' : '已進場'}
        </Button>
        {confirmAbandon ? (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmAbandon(false)}>
              不放棄
            </Button>
            <Button variant="danger" className="flex-1" onClick={onAbandon}>
              確定放棄
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setConfirmAbandon(true)}>
            沒有進場，放棄這張卡
          </Button>
        )}
      </div>
    </Card>
  )
}

/** 持倉中移動止損 */
function MoveStopCard({ t, onDone }: { t: Trade; onDone: () => void }) {
  const now = currentStop(t)
  const [to, setTo] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const v = parseNum(to)
  const against = v !== null && v > 0 && isAgainstMove(t.direction, now, v)

  async function save() {
    if (v === null || !(v > 0)) return setErrors(['新止損要是大於 0 的數字'])
    if (v === now) return setErrors(['和目前止損一樣'])
    setBusy(true)
    try {
      await moveStop(t, v)
      setTo('')
      onDone()
    } catch (err) {
      setErrors([errMsg(err)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="移動止損">
      <div className="space-y-3">
        <p className="text-sm text-paper-dim">
          目前止損 <span className="data text-paper">{now}</span>
        </p>
        <div className="flex gap-2">
          <input className={inputClass} inputMode="decimal" value={to} onChange={(ev) => setTo(ev.target.value)} placeholder="新止損價" />
          <Button className="shrink-0" onClick={save} disabled={busy}>
            記錄
          </Button>
        </div>
        {against && <p className="text-sm text-ochre">這是往不利方向移，會記為逆向移動止損（評分 −20）。</p>}
        <Errors errors={errors} />
      </div>
    </Card>
  )
}

/** 進場後才補作戰卡：+10，評分仍視為沒有作戰卡 */
function LateCardForm({ t, onDone }: { t: Trade; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(t.entry_reason ?? '')
  const [emotion, setEmotion] = useState(t.emotion === null ? '' : String(t.emotion))
  const [errors, setErrors] = useState<string[]>([])

  async function save() {
    try {
      await fillCardLate(t.id, { entry_reason: reason.trim() || null, emotion: emotion ? (Number(emotion) as Trade['emotion']) : null })
      onDone()
    } catch (err) {
      setErrors([errMsg(err)])
    }
  }

  if (!open)
    return (
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        補作戰卡 +10
      </Button>
    )
  return (
    <Card title="補作戰卡">
      <div className="space-y-3">
        <p className="text-xs text-paper-dim">進場後才補，只拿一半經驗值，評分仍算沒有作戰卡。</p>
        <Field label="進場理由">
          <textarea className={`${inputClass} min-h-20`} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
        <EmotionPicker value={emotion} onChange={setEmotion} />
        <Errors errors={errors} />
        <Button className="w-full" onClick={save}>
          存檔
        </Button>
      </div>
    </Card>
  )
}

/** 復盤：第一次寫的時間才算 */
function ReviewCard({ t, onDone }: { t: Trade; onDone: () => void }) {
  const [text, setText] = useState(t.note ?? '')
  const [status, setStatus] = useState<string>()
  const dirty = text.trim() !== (t.note ?? '')

  async function save() {
    setStatus('儲存中…')
    try {
      await saveReview(t, text)
      setStatus('已儲存')
      onDone()
    } catch (err) {
      setStatus(`儲存失敗：${errMsg(err)}`)
    }
  }

  return (
    <Card title={t.reviewed_at ? `復盤 · ${fmtDateTime(t.reviewed_at)}` : '復盤（尚未寫）'}>
      <div className="space-y-2">
        <textarea
          className={`${inputClass} min-h-28`}
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          placeholder="照計畫了嗎？哪裡可以更好？下次遇到一樣的盤面要怎麼做？"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-paper-dim">{status ?? (t.reviewed_at ? '' : '平倉後 24 小時內寫完 +20')}</span>
          <Button onClick={save} disabled={!dirty}>
            儲存復盤
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** 截圖與標註 */
function ImagesCard({ t }: { t: Trade }) {
  const images = useAsync(async () => {
    const list = await listImages(t.id)
    return Promise.all(list.map(async (img) => ({ ...img, url: await imageUrl(img.path) })))
  }, [t.id])
  return (
    <Card title="截圖">
      {images.error ? (
        <LoadError error={images.error} onRetry={images.reload} />
      ) : images.loading && !images.data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <ImageSlot kind="entry" label="進場" tradeId={t.id} images={images.data ?? []} onUploaded={images.reload} />
          {isClosed(t) && <ImageSlot kind="exit" label="出場" tradeId={t.id} images={images.data ?? []} onUploaded={images.reload} />}
        </div>
      )}
    </Card>
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
  const [caption, setCaption] = useState(img?.caption ?? '')
  const [captionStatus, setCaptionStatus] = useState<string>()

  async function upload() {
    if (!blob) return
    setBusy(true)
    setError(undefined)
    try {
      await uploadImage(tradeId, kind, blob)
      setBlob(null)
      onUploaded()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  async function saveCap() {
    if (!img || caption.trim() === (img.caption ?? '')) return
    setCaptionStatus('儲存中…')
    try {
      await saveCaption(img, caption)
      setCaptionStatus('已標註')
    } catch (err) {
      setCaptionStatus(`儲存失敗：${errMsg(err)}`)
    }
  }

  if (img)
    return (
      <div className="space-y-2">
        <span className="block text-sm text-paper-dim">{label}</span>
        <button type="button" className="block w-full" onClick={() => setFull(true)}>
          <img src={img.url} alt={`${label}截圖`} className="max-h-72 w-full rounded-lg bg-ink object-contain" />
        </button>
        <textarea
          className={`${inputClass} min-h-16 text-sm`}
          value={caption}
          onChange={(ev) => setCaption(ev.target.value)}
          onBlur={saveCap}
          placeholder="標註：結構、進場依據、哪裡看錯了（有寫才算標註）"
        />
        {captionStatus && <p className="text-xs text-paper-dim">{captionStatus}</p>}
        {full && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink" onClick={() => setFull(false)}>
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
      {error && <p className="text-sm text-ochre">{error}</p>}
    </div>
  )
}

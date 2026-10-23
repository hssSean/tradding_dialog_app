import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmotionPicker, GradeSeal, QuadrantTag, WarnIcon } from '../components/game'
import ImagePicker from '../components/ImagePicker'
import { Button, Card, Errors, Field, LoadError, Loading, PageHeader, inputClass, rColor } from '../components/ui'
import type { TradeEval } from '../game/evaluate'
import { ITEM_MAX, VIOLATION_LABELS, type ScoreItem } from '../game/rules'
import {
  abandonCard,
  deleteTrade,
  fillDetails,
  imageUrl,
  listImages,
  markEntered,
  moveStop,
  saveCaption,
  saveReview,
  uploadImage,
} from '../lib/db'
import { fmtDateTime, fmtR, fmtUsdt, fromLocalInput, parseNum, toLocalInput } from '../lib/format'
import { EXIT_REASON_LABELS, currentStop, isAgainstMove, isClosed, isPendingCard, plannedRR, tagLabel } from '../lib/trade'
import type { Emotion, ImageKind, RawTrade, Setup, Trade, TradeImage } from '../lib/types'
import { dayKey } from '../game/evaluate'
import { useAsync } from '../lib/useAsync'
import { useJournal } from '../lib/useJournal'
import { useSync } from '../lib/sync'
import { generateMissingShots } from '../lib/autoShots'
import { autoKeyOf } from '../lib/chartShots'

// 圖表套件約 160 KB，只在打開詳情頁時載入
const LazyChart = lazy(() => import('../components/TradeChart'))
function TradeChart({ trade }: { trade: RawTrade }) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-paper-dim">載入 K 線…</p>}>
      <LazyChart trade={trade} />
    </Suspense>
  )
}

const ITEM_LABELS: Record<ScoreItem, string> = {
  card: '進場前有作戰卡',
  stop: '有初始止損',
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
  const { raw, setups, setupNames, game } = journal.data
  const t = raw.find((x) => x.id === id)
  if (!t) return <p className="py-10 text-center text-paper-dim">找不到這筆交易</p>
  // 從 BingX 匯入但沒抓到止損單：算不出 R，先補資料
  if (t.planned_stop === null) return <StoplessDetail t={t} setups={setups} reload={journal.reload} />
  return (
    <Detail
      setups={setups}
      t={t as Trade}
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
  setups,
  setupName,
  cooldownEndsAt,
  reload,
}: {
  setups: Setup[]
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

        {!pending && !t.abandoned_at && t.card_at === null && t.gamified && <FillDetailsCard t={t} setups={setups} onDone={reload} />}

        {t.opened_at && (
          <Card title={t.source === 'bingx' || t.external_id ? 'K 線（BingX）' : 'K 線'}>
            <TradeChart trade={t} />
          </Card>
        )}

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
          {e.trade.pnl_usdt !== null && <p className={`data text-sm ${rColor(e.trade.pnl_usdt)}`}>{fmtUsdt(e.trade.pnl_usdt)} USDT</p>}
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
              <span className={e.items![k] < ITEM_MAX ? 'text-ochre' : 'text-paper-dim'}>{ITEM_LABELS[k]}</span>
              <span className="data">
                {e.items![k]} / {ITEM_MAX}
              </span>
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
        {cooling && <p className="text-sm text-ochre">上頭冷卻中，現在進場會記為上頭違規（評分上限 B）。</p>}
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
        {against && <p className="text-sm text-ochre">這是往不利方向移，會記為逆向移動止損（評分 −25）。</p>}
        <Errors errors={errors} />
      </div>
    </Card>
  )
}

/**
 * 晚上補資料：setup、進場理由、情緒、初始止損、目標。進場當天（台北 24:00 前）補完就算有作戰卡。
 * BingX 匯入的止損其實是「最後止損」（在 BingX 改倉位止損不留紀錄），請使用者確認初始止損；
 * 不一樣就自動記一筆移動止損。
 */
function FillDetailsCard({ t, setups, onDone }: { t: RawTrade; setups: Setup[]; onDone: () => void }) {
  const [setupId, setSetupId] = useState(t.setup_id ?? '')
  const [reason, setReason] = useState(t.entry_reason ?? '')
  const [emotion, setEmotion] = useState(t.emotion === null ? '' : String(t.emotion))
  const [stop, setStop] = useState(t.planned_stop === null ? '' : String(t.planned_stop))
  const [target, setTarget] = useState(t.planned_target === null ? '' : String(t.planned_target))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const sameDay = t.opened_at !== null && dayKey(t.opened_at) === dayKey(new Date())

  async function save() {
    const s = parseNum(stop)
    const tg = parseNum(target)
    const errs: string[] = []
    const sign = t.direction === 'long' ? 1 : -1
    if (s === null || !(s > 0)) errs.push('請填初始止損')
    else if ((t.entry_price - s) * sign <= 0) errs.push(`做${t.direction === 'long' ? '多' : '空'}的初始止損要${t.direction === 'long' ? '低於' : '高於'}進場價 ${t.entry_price}`)
    if (tg !== null && (!(tg > 0) || (tg - t.entry_price) * sign <= 0)) errs.push('目標要在獲利那一側')
    if (!reason.trim()) errs.push('請寫進場理由')
    setErrors(errs)
    if (errs.length) return
    setBusy(true)
    try {
      await fillDetails(t, {
        setup_id: setupId || null,
        entry_reason: reason.trim(),
        emotion: emotion ? (Number(emotion) as Emotion) : null,
        planned_stop: s!,
        planned_target: tg,
      })
      onDone()
    } catch (err) {
      setErrors([errMsg(err)])
      setBusy(false)
    }
  }

  const active = setups.filter((x) => !x.archived || x.id === t.setup_id)
  return (
    <Card title="補資料">
      <div className="space-y-3">
        <p className="text-xs text-paper-dim">
          {sameDay ? '今天 24:00 前補完，算有作戰卡（+20）。' : '隔天才補算補卡（+10），作戰卡那項 0 分。'}
        </p>
        <Field label="Setup">
          <select className={inputClass} value={setupId} onChange={(ev) => setSetupId(ev.target.value)}>
            <option value="">未分類</option>
            {active.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="進場理由">
          <textarea className={`${inputClass} min-h-20`} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
        <EmotionPicker value={emotion} onChange={setEmotion} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="初始止損" hint={t.source === 'bingx' && t.planned_stop !== null ? '確認是不是原本的' : undefined}>
            <input className={inputClass} inputMode="decimal" value={stop} onChange={(ev) => setStop(ev.target.value)} />
          </Field>
          <Field label="目標" hint="選填">
            <input className={inputClass} inputMode="decimal" value={target} onChange={(ev) => setTarget(ev.target.value)} />
          </Field>
        </div>
        {t.source === 'bingx' && t.planned_stop !== null && (
          <p className="text-xs text-paper-dim">
            帶入的是 BingX 上的止損 {t.planned_stop}。在 BingX 改過止損的話，這裡只看得到最後的價位，請改回進場時設的；不一樣會自動記一筆移動止損。
          </p>
        )}
        <Errors errors={errors} />
        <Button className="w-full" onClick={save} disabled={busy}>
          {busy ? '儲存中…' : '儲存'}
        </Button>
      </div>
    </Card>
  )
}

/** 沒有止損的 BingX 匯入：還算不出 R，只顯示事實、K 線與補資料表單 */
function StoplessDetail({ t, setups, reload }: { t: RawTrade; setups: Setup[]; reload: () => void }) {
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
      <p className="-mt-2 mb-4 text-sm text-paper-dim">BingX 匯入 · 沒抓到止損單，補上初始止損才算得出 R</p>
      <div className="space-y-4">
        <FillDetailsCard t={t} setups={setups} onDone={reload} />
        <Card title="成交">
          <Row label="進場">
            {fmtDateTime(t.opened_at!)}　{t.entry_price}
          </Row>
          {t.closed_at && (
            <Row label="出場">
              {fmtDateTime(t.closed_at)}　{t.exit_price}
            </Row>
          )}
          {t.pnl_usdt !== null && (
            <Row label="實際損益">
              <span className={rColor(t.pnl_usdt)}>{fmtUsdt(t.pnl_usdt)} USDT</span>
            </Row>
          )}
        </Card>
        <Card title="K 線（BingX）">
          <TradeChart trade={t} />
        </Card>
      </div>
    </>
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
  // 背景補完 K 線截圖後 version 會變，重新載入
  const { version } = useSync()
  const images = useAsync(async () => {
    const list = await listImages(t.id)
    return Promise.all(list.map(async (img) => ({ ...img, url: await imageUrl(img.path) })))
  }, [t.id, version])
  // 打開詳情頁或改了交易時，缺圖或資料變了的自動圖馬上重畫，不用等下次同步
  const { reload } = images
  useEffect(() => {
    generateMissingShots(t.id)
      .then((n) => n > 0 && reload())
      .catch((e: unknown) => console.warn('自動截圖失敗', e))
  }, [t.id, t.updated_at, reload])
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

  // 自動產生的 K 線截圖可以換成自己的截圖
  const auto = img ? autoKeyOf(img.path) !== undefined : false
  const picker = (pickerLabel: string) => (
    <>
      <ImagePicker label={pickerLabel} value={blob} onChange={setBlob} />
      {blob && (
        <Button className="w-full" onClick={upload} disabled={busy}>
          {busy ? '上傳中…' : '上傳截圖'}
        </Button>
      )}
      {error && <p className="text-sm text-ochre">{error}</p>}
    </>
  )

  if (img)
    return (
      <div className="space-y-2">
        <span className="block text-sm text-paper-dim">
          {label}
          {auto && <span className="ml-2 text-xs">自動產生（K 線）</span>}
        </span>
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
        {auto && picker('換成自己的截圖')}
        {full && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink" onClick={() => setFull(false)}>
            <img src={img.url} alt={`${label}截圖`} className="max-h-full max-w-full object-contain" />
          </div>
        )}
      </div>
    )

  return <div className="space-y-2">{picker(`${label}（未上傳）`)}</div>
}

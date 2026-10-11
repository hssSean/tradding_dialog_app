import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DraftBanner from '../components/DraftBanner'
import EntryFields from '../components/EntryFields'
import { EmotionPicker } from '../components/game'
import ImagePicker from '../components/ImagePicker'
import { Button, Errors, LoadError, Loading, PageHeader } from '../components/ui'
import { DEBUFF_NAMES } from '../game/rules'
import { createTrade, uploadImage } from '../lib/db'
import { toLocalInput } from '../lib/format'
import { type EntryForm, emptyEntryForm, parseEntry } from '../lib/forms'
import { recentSymbols } from '../lib/trade'
import { useDraftForm } from '../lib/useDraft'
import { type Journal, useJournal } from '../lib/useJournal'

/**
 * card：立作戰卡（進場前，+20 經驗值），存檔後到詳情頁按「已進場」。
 * late：補記交易（已經進場、沒有作戰卡，會記為 FOMO）。
 */
type Mode = 'card' | 'late'

export default function NewTrade({ mode }: { mode: Mode }) {
  const { data, error, reload } = useJournal()
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data) return <Loading />
  return <EntryPage journal={data} mode={mode} />
}

function EntryPage({ journal, mode }: { journal: Journal; mode: Mode }) {
  const navigate = useNavigate()
  const { daily, debuffs } = journal.game
  const draft = useDraftForm<EntryForm>(
    mode === 'card' ? 'draft:card' : 'draft:new',
    emptyEntryForm(mode === 'card' ? '' : toLocalInput(new Date().toISOString())),
  )
  const [image, setImage] = useState<Blob | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const f = draft.form
  const emotion = f.emotion ? Number(f.emotion) : null

  // 二次確認的理由（SPEC §4.1、§4.4）：情緒 ≥ 4、精神力低於 60
  const reasons: string[] = []
  if (emotion !== null && emotion >= 4) reasons.push(`情緒 ${emotion}：現在的判斷可能被情緒推著走。`)
  if (daily.hp < 60) reasons.push(`精神力 ${daily.hp}（${daily.hpLabel}）：${daily.hp < 30 ? '建議今天到此為止。' : '已經有點累了。'}`)
  const cooldown = debuffs.find((d) => d.kind === 'cooldown' && Date.parse(d.endsAt) > Date.now())

  function setForm(next: EntryForm) {
    draft.setForm(next)
    setConfirming(false)
  }

  async function submit() {
    const { value, errors } = parseEntry(f)
    setErrors(errors)
    if (errors.length) return
    if (reasons.length && !confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    try {
      const trade = await createTrade(value)
      draft.clear()
      if (image) await uploadImage(trade.id, 'entry', image).catch(() => undefined)
      navigate(mode === 'card' ? `/trade/${trade.id}` : '/log', { replace: true })
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)])
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={mode === 'card' ? '立作戰卡' : '補記交易'}
        right={
          <Button variant="secondary" onClick={() => navigate(-1)}>
            取消
          </Button>
        }
      />
      {draft.pending && <DraftBanner onRestore={draft.restore} onDiscard={draft.discard} />}

      {mode === 'late' && (
        <p className="mb-4 rounded-md border border-ochre/40 p-3 text-sm text-ochre">
          沒有作戰卡就進場會記為 FOMO，評分少 25 分。存檔後可以在詳情頁補卡（+10 經驗值）。
          <Link to="/card/new" className="ml-1 underline">
            還沒進場？改立作戰卡
          </Link>
        </p>
      )}
      {mode === 'card' && cooldown && (
        <p className="mb-4 rounded-md border border-ochre/40 p-3 text-sm text-ochre">
          {DEBUFF_NAMES.cooldown}冷卻中：冷卻結束前按「已進場」會記為上頭違規（評分上限 B）。
        </p>
      )}

      <div className="space-y-4">
        <EntryFields
          value={f}
          onChange={setForm}
          setups={journal.setups}
          recentSymbols={recentSymbols(journal.trades)}
          withOpenTime={mode === 'late'}
        />
        <EmotionPicker value={f.emotion} onChange={(v) => setForm({ ...f, emotion: v })} />
        <ImagePicker label="進場截圖" value={image} onChange={setImage} />
        <Errors errors={errors} />

        {confirming && (
          <div className="space-y-2 rounded-md border border-ochre/50 bg-ochre/10 p-3 text-sm">
            <p className="font-brush text-lg text-ochre">再想一下</p>
            {reasons.map((r) => (
              <p key={r} className="text-paper">
                {r}
              </p>
            ))}
            <p className="text-paper-dim">確定還是要存檔，再按一次下面的按鈕。</p>
          </div>
        )}

        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? '儲存中…' : confirming ? '確定存檔' : mode === 'card' ? '存作戰卡 +20' : '儲存交易'}
        </Button>
      </div>
    </>
  )
}

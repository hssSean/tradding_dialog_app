import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DraftBanner from '../components/DraftBanner'
import EntryFields from '../components/EntryFields'
import ImagePicker from '../components/ImagePicker'
import { Button, Errors, LoadError, Loading, PageHeader } from '../components/ui'
import { createTrade, uploadImage } from '../lib/db'
import { toLocalInput } from '../lib/format'
import { type EntryForm, emptyEntryForm, parseEntry } from '../lib/forms'
import { recentSymbols } from '../lib/trade'
import { useDraftForm } from '../lib/useDraft'
import { type Journal, useJournal } from '../lib/useJournal'

export default function NewTrade() {
  const { data, error, reload } = useJournal()
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data) return <Loading />
  return <NewTradeForm journal={data} />
}

function NewTradeForm({ journal }: { journal: Journal }) {
  const navigate = useNavigate()
  const draft = useDraftForm<EntryForm>(
    'draft:new',
    emptyEntryForm(journal.settings.standard_risk_usdt, toLocalInput(new Date().toISOString())),
  )
  const [image, setImage] = useState<Blob | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function submit() {
    const { value, errors } = parseEntry(draft.form)
    setErrors(errors)
    if (errors.length) return
    setBusy(true)
    try {
      const trade = await createTrade(value)
      draft.clear()
      if (image) {
        // 截圖失敗不擋交易存檔，詳情頁可以補傳
        await uploadImage(trade.id, 'entry', image).catch(() => undefined)
      }
      navigate('/', { replace: true })
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)])
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="新增交易" right={<Button variant="secondary" onClick={() => navigate(-1)}>取消</Button>} />
      {draft.pending && <DraftBanner onRestore={draft.restore} onDiscard={draft.discard} />}
      <div className="space-y-4">
        <EntryFields value={draft.form} onChange={draft.setForm} setups={journal.setups} recentSymbols={recentSymbols(journal.trades)} />
        <ImagePicker label="進場截圖" value={image} onChange={setImage} />
        <Errors errors={errors} />
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? '儲存中…' : '儲存進場'}
        </Button>
      </div>
    </>
  )
}

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import EntryFields from '../components/EntryFields'
import ExitFields from '../components/ExitFields'
import { Button, Errors, LoadError, Loading, PageHeader } from '../components/ui'
import { updateTrade } from '../lib/db'
import { entryToForm, exitToForm, parseEntry, parseExit } from '../lib/forms'
import { isClosed, recentSymbols } from '../lib/trade'
import type { Trade } from '../lib/types'
import { type Journal, useJournal } from '../lib/useJournal'

export default function EditTrade() {
  const { id } = useParams()
  const { data, error, reload } = useJournal()
  if (error) return <LoadError error={error} onRetry={reload} />
  if (!data) return <Loading />
  const trade = data.trades.find((t) => t.id === id)
  if (!trade) return <p className="py-10 text-center text-zinc-500">找不到這筆交易</p>
  return <EditForm trade={trade} journal={data} />
}

function EditForm({ trade, journal }: { trade: Trade; journal: Journal }) {
  const navigate = useNavigate()
  const closed = isClosed(trade)
  const [entry, setEntry] = useState(() => entryToForm(trade))
  const [exit, setExit] = useState(() => exitToForm(trade))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function submit() {
    const e = parseEntry(entry)
    const x = closed ? parseExit(exit, e.value) : null
    const all = [...e.errors, ...(x?.errors ?? [])]
    setErrors(all)
    if (all.length) return
    setBusy(true)
    try {
      await updateTrade(trade.id, x ? { ...e.value, ...x.value } : e.value)
      navigate(`/trade/${trade.id}`, { replace: true })
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)])
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={`編輯 ${trade.symbol}`} right={<Button variant="secondary" onClick={() => navigate(-1)}>取消</Button>} />
      <div className="space-y-6">
        <EntryFields value={entry} onChange={setEntry} setups={journal.setups} recentSymbols={recentSymbols(journal.trades)} />
        {closed && (
          <>
            <hr className="border-zinc-800" />
            <ExitFields value={exit} onChange={setExit} />
          </>
        )}
        <Errors errors={errors} />
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? '儲存中…' : '儲存'}
        </Button>
      </div>
    </>
  )
}

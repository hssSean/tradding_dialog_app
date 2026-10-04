import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadError, Loading, inputClass } from '../components/ui'
import { dayKey } from '../game/evaluate'
import { saveNote } from '../lib/db'
import { weekTitle } from '../lib/format'
import { weekStartOf } from '../lib/stats'
import type { DailyNote } from '../lib/types'
import { type Journal, useJournal } from '../lib/useJournal'

/**
 * 每日筆記：今天的市場觀察（每日功課 +30，休息日也能維持連續天數）、
 * 本週最大的錯誤（每週功課 +60，存在本週一那一列）。
 */
export default function Notes() {
  const journal = useJournal()
  if (journal.error) return <LoadError error={journal.error} onRetry={journal.reload} />
  if (!journal.data) return <Loading />
  return <NotesPage journal={journal.data} reload={journal.reload} />
}

function NoteBox({
  label,
  hint,
  initial,
  onSave,
}: {
  label: string
  hint: string
  initial: string
  onSave: (text: string) => Promise<void>
}) {
  const [text, setText] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [status, setStatus] = useState<string>()

  async function save() {
    if (text.trim() === saved.trim()) return
    setStatus('儲存中…')
    try {
      await onSave(text)
      setSaved(text)
      setStatus('已儲存')
    } catch (e) {
      setStatus(`儲存失敗：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="sec-title">{label}</h2>
        <span className="text-xs text-paper-dim">{status ?? hint}</span>
      </div>
      <textarea className={`${inputClass} min-h-32`} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
    </section>
  )
}

function NotesPage({ journal, reload }: { journal: Journal; reload: () => void }) {
  const today = dayKey(new Date())
  const week = weekStartOf(new Date())
  const note = (date: string): DailyNote | undefined => journal.notes.find((n) => n.date === date)
  const history = journal.notes.filter((n) => n.date !== today && n.market_view).slice(0, 14)

  return (
    <div className="space-y-8">
      <header className="flex items-baseline justify-between">
        <h1 className="sec-title" style={{ fontSize: 28 }}>
          每日筆記
        </h1>
        <Link to="/log" className="text-sm text-moon">
          返回日誌
        </Link>
      </header>

      <NoteBox
        label={`市場觀察 · ${today.slice(5).replace('-', '/')}`}
        hint="開盤前寫 +30"
        initial={note(today)?.market_view ?? ''}
        onSave={async (text) => {
          await saveNote(today, { market_view: text.trim() || null })
          reload()
        }}
      />

      <NoteBox
        label={`本週最大的錯誤 · ${weekTitle(week)}`}
        hint="每週一次 +60"
        initial={note(week)?.weekly_mistake ?? ''}
        onSave={async (text) => {
          await saveNote(week, { weekly_mistake: text.trim() || null })
          reload()
        }}
      />

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 font-brush text-lg text-paper-dim">之前的觀察</h2>
          <ul className="divide-y divide-ink-line">
            {history.map((n) => (
              <li key={n.date} className="py-3">
                <p className="data text-xs text-paper-dim">{n.date}</p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{n.market_view}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

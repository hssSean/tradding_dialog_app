import { useState } from 'react'
import type { ExitForm } from '../lib/forms'
import { EXIT_REASON_LABELS, MANUAL_TAG_KEYS, tagLabel } from '../lib/trade'
import type { ExitReason } from '../lib/types'
import { Field, inputClass } from './ui'

export default function ExitFields({ value: f, onChange }: { value: ExitForm; onChange: (f: ExitForm) => void }) {
  const set = <K extends keyof ExitForm>(k: K, v: ExitForm[K]) => onChange({ ...f, [k]: v })
  const [custom, setCustom] = useState('')
  const customTags = f.mistake_tags.filter((t) => !MANUAL_TAG_KEYS.includes(t))

  const toggle = (tag: string) =>
    set('mistake_tags', f.mistake_tags.includes(tag) ? f.mistake_tags.filter((t) => t !== tag) : [...f.mistake_tags, tag])

  function addCustom() {
    const t = custom.trim()
    if (t && !f.mistake_tags.includes(t)) set('mistake_tags', [...f.mistake_tags, t])
    setCustom('')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="出場價">
          <input className={inputClass} inputMode="decimal" value={f.exit_price} onChange={(e) => set('exit_price', e.target.value)} />
        </Field>
        <Field label="最後止損" hint="有移動才改">
          <input className={inputClass} inputMode="decimal" value={f.final_stop} onChange={(e) => set('final_stop', e.target.value)} />
        </Field>
      </div>

      <Field label="出場時間">
        <input className={inputClass} type="datetime-local" value={f.closed_at} onChange={(e) => set('closed_at', e.target.value)} />
      </Field>

      <div>
        <span className="mb-1 block text-sm text-paper-dim">出場原因</span>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(EXIT_REASON_LABELS) as ExitReason[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => set('exit_reason', r)}
              className={`min-h-11 rounded-lg text-sm ${f.exit_reason === r ? 'bg-moon text-ink' : 'bg-paper/10 text-paper'}`}
            >
              {EXIT_REASON_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <Field label="實際損益 USDT" hint="選填，含手續費；虧損填正數也會自動轉負">
        <input
          className={inputClass}
          inputMode="decimal"
          value={f.pnl_usdt}
          onChange={(e) => set('pnl_usdt', e.target.value)}
          placeholder="不填就用 R × 風險估算"
        />
      </Field>

      <div>
        <span className="mb-1 block text-sm text-paper-dim">自評標籤</span>
        <div className="flex flex-wrap gap-2">
          {[...MANUAL_TAG_KEYS, ...customTags].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              className={`min-h-10 rounded-full px-3 text-sm ${
                f.mistake_tags.includes(t) ? 'bg-moon text-ink' : 'bg-paper/10 text-paper'
              }`}
            >
              {tagLabel(t)}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className={inputClass}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="自訂標籤"
          />
          <button type="button" className="min-h-11 shrink-0 rounded-lg bg-paper/10 px-4 text-sm" onClick={addCustom}>
            加入
          </button>
        </div>
      </div>

      <Field label="復盤" hint="平倉後 24 小時內寫完 +20，之後也能在詳情頁補">
        <textarea
          className={`${inputClass} min-h-24`}
          value={f.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="照計畫了嗎？哪裡可以更好？"
        />
      </Field>
    </div>
  )
}

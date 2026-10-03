import type { EntryForm } from '../lib/forms'
import type { Setup } from '../lib/types'
import { Field, Segmented, inputClass } from './ui'

interface Props {
  value: EntryForm
  onChange: (f: EntryForm) => void
  setups: Setup[]
  recentSymbols: string[]
}

export default function EntryFields({ value: f, onChange, setups, recentSymbols }: Props) {
  const set = <K extends keyof EntryForm>(k: K, v: EntryForm[K]) => onChange({ ...f, [k]: v })
  const active = setups.filter((s) => !s.archived || s.id === f.setup_id)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="幣種">
          <input
            className={inputClass}
            list="recent-symbols"
            autoCapitalize="characters"
            autoCorrect="off"
            value={f.symbol}
            onChange={(e) => set('symbol', e.target.value)}
            placeholder="BTCUSDT"
          />
          <datalist id="recent-symbols">
            {recentSymbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="方向">
          <Segmented
            value={f.direction}
            onChange={(v) => set('direction', v)}
            options={[
              { value: 'long', label: '做多', className: 'bg-emerald-700 text-white' },
              { value: 'short', label: '做空', className: 'bg-red-700 text-white' },
            ]}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Setup">
          <select className={inputClass} value={f.setup_id} onChange={(e) => set('setup_id', e.target.value)}>
            <option value="">未分類</option>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="時間框架">
          <input className={inputClass} value={f.timeframe} onChange={(e) => set('timeframe', e.target.value)} placeholder="15m / 1h" />
        </Field>
      </div>

      <Field label="進場時間">
        <input className={inputClass} type="datetime-local" value={f.opened_at} onChange={(e) => set('opened_at', e.target.value)} />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="進場價">
          <input className={inputClass} inputMode="decimal" value={f.entry_price} onChange={(e) => set('entry_price', e.target.value)} />
        </Field>
        <Field label="計畫止損">
          <input className={inputClass} inputMode="decimal" value={f.planned_stop} onChange={(e) => set('planned_stop', e.target.value)} />
        </Field>
        <Field label="目標" hint="選填">
          <input
            className={inputClass}
            inputMode="decimal"
            value={f.planned_target}
            onChange={(e) => set('planned_target', e.target.value)}
          />
        </Field>
      </div>

      <Field label="風險金額" hint="這筆最多虧幾 USDT">
        <input className={inputClass} inputMode="decimal" value={f.risk_usdt} onChange={(e) => set('risk_usdt', e.target.value)} />
      </Field>

      <Field label="進場理由">
        <textarea className={`${inputClass} min-h-20`} value={f.entry_reason} onChange={(e) => set('entry_reason', e.target.value)} />
      </Field>
    </div>
  )
}

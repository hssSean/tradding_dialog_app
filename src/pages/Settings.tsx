import { useState } from 'react'
import { Button, Card, Errors, Field, LoadError, Loading, PageHeader, inputClass } from '../components/ui'
import { buildInfo, createSetup, signOut, storageUsageBytes, updateSettings, updateSetup } from '../lib/db'
import { parseNum } from '../lib/format'
import type { Setup } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { type Journal, useJournal } from '../lib/useJournal'

const STORAGE_LIMIT_MB = 1024

export default function Settings() {
  const journal = useJournal()
  if (journal.error) return <LoadError error={journal.error} onRetry={journal.reload} />
  if (!journal.data) return <Loading />
  return <SettingsForm journal={journal.data} reload={journal.reload} />
}

function SettingsForm({ journal, reload }: { journal: Journal; reload: () => void }) {
  const [risk, setRisk] = useState(String(journal.settings.standard_risk_usdt))
  const [riskStatus, setRiskStatus] = useState<string>()
  const [newSetup, setNewSetup] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const usage = useAsync(storageUsageBytes, [])

  /** 成功回 true；失敗顯示錯誤回 false */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setErrors([])
    try {
      await fn()
      reload()
      return true
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)])
      return false
    }
  }

  async function saveRisk() {
    const v = parseNum(risk)
    if (v === null || !(v > 0)) {
      setRiskStatus('要大於 0')
      return
    }
    setRiskStatus((await run(() => updateSettings(v))) ? '已儲存' : undefined)
  }

  async function addSetup() {
    const name = newSetup.trim()
    if (!name) return
    if (await run(() => createSetup(name, journal.setups.length))) setNewSetup('')
  }

  function rename(s: Setup) {
    const name = prompt('新名稱', s.name)?.trim()
    if (name && name !== s.name) void run(() => updateSetup(s.id, { name }))
  }

  /** 跟相鄰的交換位置，整份清單依新順序重新編號（舊資料的 sort_order 可能重複） */
  function move(i: number, delta: -1 | 1) {
    const list = [...journal.setups]
    const j = i + delta
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    void run(() => Promise.all(list.map((s, idx) => (s.sort_order === idx ? null : updateSetup(s.id, { sort_order: idx })))))
  }

  const usedMb = usage.data === undefined ? null : usage.data / 1024 / 1024

  return (
    <>
      <PageHeader title="設定" />
      <div className="space-y-4">
        <Errors errors={errors} />

        <Card title="標準風險">
          <Field label="每筆標準風險 USDT" hint="超過 1.5 倍會標「超額倉位」">
            <div className="flex gap-2">
              <input className={inputClass} inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} />
              <Button className="shrink-0" onClick={saveRisk}>
                儲存
              </Button>
            </div>
          </Field>
          {riskStatus && <p className="mt-1 text-xs text-zinc-500">{riskStatus}</p>}
        </Card>

        <Card title="Setup 清單">
          <ul className="divide-y divide-zinc-800">
            {journal.setups.map((s, i) => (
              <li key={s.id} className="flex items-center gap-1 py-1">
                <button type="button" className={`min-h-11 flex-1 text-left ${s.archived ? 'text-zinc-600 line-through' : ''}`} onClick={() => rename(s)}>
                  {s.name}
                </button>
                <button type="button" className="min-h-11 min-w-9 text-zinc-400 disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
                  ↑
                </button>
                <button
                  type="button"
                  className="min-h-11 min-w-9 text-zinc-400 disabled:opacity-20"
                  disabled={i === journal.setups.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="下移"
                >
                  ↓
                </button>
                <button type="button" className="min-h-11 px-2 text-sm text-zinc-400" onClick={() => void run(() => updateSetup(s.id, { archived: !s.archived }))}>
                  {s.archived ? '取消封存' : '封存'}
                </button>
              </li>
            ))}
          </ul>
          {journal.setups.length === 0 && <p className="text-sm text-zinc-500">還沒有 setup，例如「突破回踩」「假突破」。</p>}
          <div className="mt-3 flex gap-2">
            <input
              className={inputClass}
              value={newSetup}
              onChange={(e) => setNewSetup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addSetup()
              }}
              placeholder="新增 setup"
            />
            <Button className="shrink-0" onClick={addSetup}>
              新增
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-600">點名稱可改名。封存後新增交易時不會出現，但舊交易的統計還在。</p>
        </Card>

        <Card title="截圖儲存用量">
          {usedMb === null ? (
            <p className="text-sm text-zinc-500">計算中…</p>
          ) : (
            <>
              <p className="text-sm">
                {usedMb.toFixed(1)} MB / {STORAGE_LIMIT_MB} MB
              </p>
              <div className="mt-2 h-2 rounded-full bg-zinc-800">
                <div className="h-2 rounded-full bg-sky-600" style={{ width: `${Math.min(100, (usedMb / STORAGE_LIMIT_MB) * 100)}%` }} />
              </div>
            </>
          )}
        </Card>

        <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
          登出
        </Button>
        <p className="text-center text-xs text-zinc-600">{buildInfo}</p>
      </div>
    </>
  )
}

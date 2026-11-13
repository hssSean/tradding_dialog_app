import { useState } from 'react'
import { fmtDateTime } from '../lib/format'
import { disablePush, enablePush, pushStatus, type PushStatus } from '../lib/push'
import { lastTickAt } from '../lib/db'
import { useAsync } from '../lib/useAsync'
import { Button, Errors } from './ui'

const LABELS: Record<PushStatus, string> = {
  unsupported: '這個瀏覽器不支援推播',
  'need-install': 'iOS 要先從 Safari「分享 → 加入主畫面」，再從主畫面開 App 才能開推播',
  denied: '通知被關掉了：iPhone 設定 → 通知 → 交易日誌 打開',
  off: '未開啟',
  on: '已開啟：開倉、平倉、每晚 22:00 待標記提醒',
}

/** 設定頁的推播開關 */
export default function PushSettings() {
  const status = useAsync(pushStatus, [])
  const tick = useAsync(lastTickAt, [])
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setErrors([])
    try {
      await fn()
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)])
    }
    setBusy(false)
    status.reload()
  }

  const s = status.data
  return (
    <div className="space-y-2">
      <p className="text-sm text-paper-dim">推播：{s ? LABELS[s] : status.error ? status.error.message : '檢查中…'}</p>
      {s === 'on' && (
        <p className="text-xs text-paper-dim/70">排程最後執行：{tick.data ? fmtDateTime(tick.data) : '還沒跑過'}</p>
      )}
      <Errors errors={errors} />
      {(s === 'off' || s === 'on') && (
        <Button variant="secondary" className="w-full" disabled={busy} onClick={() => void run(s === 'on' ? disablePush : enablePush)}>
          {busy ? '處理中…' : s === 'on' ? '關閉推播' : '開啟推播（會送一則測試）'}
        </Button>
      )}
    </div>
  )
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getSettings, syncBingx, type SyncResult } from './db'

/** 距離上次同步超過這麼久，開 App 時就自動同步 */
const AUTO_SYNC_AFTER_MS = 5 * 60_000

interface SyncState {
  syncing: boolean
  progress: { done: number; total: number } | null
  result: SyncResult | null
  error: string | null
  /** 每次同步完成 +1，useJournal 依此重新載入 */
  version: number
  syncNow: () => void
}

const SyncContext = createContext<SyncState>({
  syncing: false,
  progress: null,
  result: null,
  error: null,
  version: 0,
  syncNow: () => {},
})

export function SyncProvider({ children }: { children: ReactNode }) {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncState['progress']>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const running = useRef(false)

  const syncNow = useCallback(() => {
    if (running.current) return
    running.current = true
    setSyncing(true)
    setError(null)
    syncBingx((done, total) => setProgress({ done, total }))
      .then((r) => {
        setResult(r)
        if (r.failed.length) setError(`${r.failed.length} 個幣種同步失敗：${r.failed.map((f) => `${f.symbol}（${f.error}）`).join('、')}`)
        setVersion((v) => v + 1)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        running.current = false
        setSyncing(false)
        setProgress(null)
      })
  }, [])

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (!s.bingx_synced_at || Date.now() - Date.parse(s.bingx_synced_at) > AUTO_SYNC_AFTER_MS) syncNow()
      })
      .catch(() => undefined)
  }, [syncNow])

  return <SyncContext.Provider value={{ syncing, progress, result, error, version, syncNow }}>{children}</SyncContext.Provider>
}

export const useSync = () => useContext(SyncContext)

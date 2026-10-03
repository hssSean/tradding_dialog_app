import { getSettings, listSetups, listTrades } from './db'
import { useAsync } from './useAsync'
import type { Settings, Setup, Trade } from './types'

export interface Journal {
  trades: Trade[]
  setups: Setup[]
  settings: Settings
  setupNames: Map<string, string>
}

/** 交易、setup、設定一起抓。單人使用、一年幾百筆，全抓回來在前端算就好。 */
export function useJournal(deps: unknown[] = []) {
  return useAsync<Journal>(async () => {
    const [trades, setups, settings] = await Promise.all([listTrades(), listSetups(), getSettings()])
    return { trades, setups, settings, setupNames: new Map(setups.map((s) => [s.id, s.name])) }
  }, deps)
}

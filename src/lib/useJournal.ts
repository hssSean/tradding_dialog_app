import { computeGameState, type GameState } from '../game/engine'
import type { ImageMeta } from '../game/progress'
import { getSettings, listImageMeta, listNotes, listSetups, listTrades } from './db'
import { useSync } from './sync'
import { useAsync } from './useAsync'
import type { DailyNote, RawTrade, Settings, Setup, Trade } from './types'

export interface Journal {
  /** 止損完整的交易：進引擎與統計 */
  trades: Trade[]
  /** 資料庫裡的全部紀錄（含待補止損） */
  raw: RawTrade[]
  /** 晚上要補的：BingX 匯入還沒補理由，或沒有止損 */
  pending: RawTrade[]
  setups: Setup[]
  settings: Settings
  notes: DailyNote[]
  images: ImageMeta[]
  setupNames: Map<string, string>
  /** 遊戲化推導值，以載入當下的時間計算 */
  game: GameState
}

const hasStop = (t: RawTrade): t is Trade => t.planned_stop !== null

/** 待補：已進場、沒放棄，且（沒有止損，或 BingX 匯入還沒補理由） */
export function needsDetails(t: RawTrade): boolean {
  return t.opened_at !== null && t.abandoned_at === null && (t.planned_stop === null || (t.source === 'bingx' && t.card_at === null))
}

/** 全部資料一起抓。單人使用、一年幾百筆，全抓回來在前端算就好。BingX 同步完成會自動重新載入。 */
export function useJournal(deps: unknown[] = []) {
  const { version } = useSync()
  return useAsync<Journal>(async () => {
    const [raw, setups, settings, notes, images] = await Promise.all([listTrades(), listSetups(), getSettings(), listNotes(), listImageMeta()])
    const trades = raw.filter(hasStop)
    const game = computeGameState({ trades, images, notes, setups, displayTitle: settings.display_title, now: new Date() })
    return {
      trades,
      raw,
      pending: raw.filter(needsDetails).sort((a, b) => Date.parse(b.opened_at!) - Date.parse(a.opened_at!)),
      setups,
      settings,
      notes,
      images,
      setupNames: new Map(setups.map((s) => [s.id, s.name])),
      game,
    }
  }, [...deps, version])
}

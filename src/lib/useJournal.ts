import { computeGameState, type GameState } from '../game/engine'
import type { ImageMeta } from '../game/progress'
import { getSettings, listImageMeta, listNotes, listSetups, listTrades } from './db'
import { useAsync } from './useAsync'
import type { DailyNote, Settings, Setup, Trade } from './types'

export interface Journal {
  trades: Trade[]
  setups: Setup[]
  settings: Settings
  notes: DailyNote[]
  images: ImageMeta[]
  setupNames: Map<string, string>
  /** 遊戲化推導值，以載入當下的時間計算 */
  game: GameState
}

/** 全部資料一起抓。單人使用、一年幾百筆，全抓回來在前端算就好。 */
export function useJournal(deps: unknown[] = []) {
  return useAsync<Journal>(async () => {
    const [trades, setups, settings, notes, images] = await Promise.all([
      listTrades(),
      listSetups(),
      getSettings(),
      listNotes(),
      listImageMeta(),
    ])
    const game = computeGameState({
      trades,
      images,
      notes,
      setups,
      startingEquity: settings.starting_equity,
      displayTitle: settings.display_title,
      now: new Date(),
    })
    return { trades, setups, settings, notes, images, setupNames: new Map(setups.map((s) => [s.id, s.name])), game }
  }, deps)
}

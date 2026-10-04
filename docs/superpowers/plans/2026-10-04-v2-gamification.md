# 交易日誌 v2（夜墨首頁＋遊戲化）實作計畫

規格：`trade-journal-handoff/SPEC.md`（以下稱 SPEC）。參考實作：`trade-journal-handoff/reference/`。

## 已確認的決定（2026-10-04）

| 議題 | 決定 |
|---|---|
| 帳戶權益 | 設定頁填**起始權益**，之後每筆平倉自動加上損益；作戰卡存檔時把當下權益寫進 `equity_at_entry` |
| 作戰卡 | 作戰卡＝待進場的交易（`opened_at IS NULL`）。「已進場」補成交價與時間；「放棄」記 `abandoned_at`。沒立卡就進場走「補記交易」（FOMO），事後可補卡（`card_at > opened_at`，+10） |
| 紀律規則 | 全部改用 SPEC 規則（規則只有一份）。舊的 `autoFlags`／30 分鐘報復單移除；每週檢討頁保留，紀律分組改吃引擎的違規 |
| 移動止損 | 持倉中按「移動止損」寫入 `stop_edits`；平倉時改最後止損也記一筆 |
| 復盤 | 平倉表單「復盤」欄，第一次填寫時記 `reviewed_at`；詳情頁可補寫 |
| 截圖標註 | `journal_trade_images.caption`，有文字才算標註 |
| 功課 | 完成狀態由紀錄推導；點擊帶到對應動作（不能手動打勾） |
| 舊資料 | migration 前的交易 `gamified = false`：評分顯示「資料不足」，不進階級、屬性、心魔、紀律分數；R 照算 |

## 偏離 SPEC 之處

- 初始止損維持必填（現有 R、統計全靠它）。SPEC「沒有初始止損」那項在 UI 上不會發生，引擎仍處理 null。
- 成就給的經驗值 SPEC 沒寫數字，暫定每個 +100。
- 賽季獎勵（主題配色、頭像框）SPEC 沒有具體清單，這版只做稱號收藏與替換。

## 資料庫 migration（`supabase/migrations/2026-10-04-v2.sql`）

- `journal_trades`：`opened_at` 改可為 null；新增 `card_at`、`emotion`（1–5）、`equity_at_entry`、`stop_edits jsonb`、`reviewed_at`、`abandoned_at`、`gamified`（既有列設 false）
- `journal_trade_images`：`caption`、`captioned_at`
- `journal_settings`：`starting_equity`、`display_title`
- `journal_setups`：`reviewed_at`
- 新表 `journal_daily_notes(user_id, date, market_view, weekly_mistake)`＋RLS

## 階段

1. **視覺與圖示**：設計 token、字型、紙紋、icons、manifest、head；全站改用 token（盈虧不用紅綠）；分頁改 首頁／日誌／圖鑑／角色
2. **資料補欄位＋作戰卡**：migration、型別、`db.ts`、作戰卡表單（情緒 ≥4 二次確認、超風險赭色）、已進場、補記、移動止損、復盤、截圖標註、每日筆記
3. **遊戲化引擎＋測試**：`src/game/engine.ts` 純函數，SPEC §8 列的情境全部有單元測試
4. **首頁、心魔、功課、圖鑑、成就、賽季**：首頁照 `reference/` 移植並接引擎；圖鑑頁、角色頁、每週檢討頁改接引擎

每階段結束：`npm test`、`tsc -b`、`npm run build` 全過再 commit；全部完成後 push 部署。

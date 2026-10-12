# BingX 自動匯入實作計畫

規格：`docs/superpowers/specs/2026-10-12-bingx-sync-design.md`

## 2026-10-12 用真實 key 驗證到的事實（寫程式依這裡，不依文件猜）

- `positionHistory.data.positionHistory[]`：`positionId`（字串）、`symbol`（`ADA-USDT`）、`positionSide`（`LONG`/`SHORT`）、`openTime`、`updateTime`（ms）、`avgPrice`、`avgClosePrice`、`realisedProfit`、`netProfit`（含手續費、資金費）、`positionCommission`、`totalFunding`、`closeAllPositions`、`leverage`。
- `allOrders.data.orders[]`：`orderId`、`type`（`MARKET`/`LIMIT`/`STOP_MARKET`/`TAKE_PROFIT_MARKET`）、`status`（`FILLED`/`CANCELLED`）、`side`、`positionSide`、`stopPrice`、`avgPrice`、`time`、`updateTime`、`reduceOnly`、`positionID`。
  - ⚠ **`positionID` 是超過 2^53 的 JSON 數字**，`JSON.parse` 會失準（`…431042` → `…431000`）。解析前用 regex 把它轉成字串。
  - ⚠ **查詢區間最多 7 天**（`109400 the query range is more than seven days`），要切段查。
  - 止損單在開倉後才掛（例：ADA 14:57 開倉、15:03 掛止損）；改止損＝取消舊單、新掛一張。
- `income`（`incomeType=TRADING_FEE`，不帶 symbol）可列出所有交易過的幣種。
- `v3/quote/klines`：公開，`[{open, close, high, low, volume, time}]`。
- 過去 30 天 172 個倉位；10/4 起 34 個，日誌只有 11 筆。

## 任務

1. **Migration**：`source`、`external_id`（唯一）、`planned_stop` 可空、`journal_settings.bingx_synced_at`。
2. **純函數 `src/sync/`**（vitest）：
   - `sign.ts`：參數排序、HMAC 簽章字串
   - `parse.ts`：大數 `positionID` 轉字串
   - `convert.ts`：倉位＋訂單 → 交易列；初始止損＝第一張止損單（方向不對就當作沒有）、`stop_edits`、`final_stop`、目標＝第一張止盈單、出場原因
   - `match.ts`：對帳手動紀錄（作戰卡 12 小時內、手動交易 ±30 分鐘、取最接近）；upsert 時哪些欄位可覆蓋
3. **Vercel 函數 `api/bingx/`**：`sync.ts`、`klines.ts`、共用 `_client.ts`（驗證 JWT＋owner、BingX 請求、7 天切段、分頁）。`vercel.json`：`regions: ["sin1"]`、rewrite 排除 `/api/`。`tsconfig.api.json`。
4. **評分規則**：作戰卡當天（台北 24:00 前）補完算有；當天還沒過完不算 FOMO。
5. **前端**：`SyncProvider`（開 App 自動同步，5 分鐘節流）、`useJournal` 分出待補止損、首頁待補提示、日誌待補區與立即同步、詳情頁補資料表單與 K 線圖（`lightweight-charts`）、角色頁同步狀態。
6. **部署**：Vercel 環境變數 `BINGX_API_KEY`、`BINGX_SECRET_KEY`、`JOURNAL_OWNER_USER_ID`；第一次同步從日誌第一筆交易那天（10/4）開始。
7. **驗證**：真實同步後逐筆對照 BingX 歷史倉位；手動的 11 筆要合併、不能重複。

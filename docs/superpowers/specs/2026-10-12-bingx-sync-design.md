# BingX 自動匯入與 K 線圖 — 設計規格

日期：2026-10-12
狀態：已核准設計（使用者 2026-10-12 確認）

## 1. 目的

使用者常忘記記錄交易。改成：在 BingX 正常下單，App 自動從 BingX 抓成交、合成交易紀錄，使用者當天晚上再補 setup、理由、情緒與復盤。詳情頁用 K 線自動畫出進出場，取代手動截圖。

## 2. 範圍

**做：**
- BingX USDT 永續合約的自動匯入：一個倉位（從開到全平）＝一筆交易
- 初始止損、移動止損由 BingX 的止損單自動推導
- 與手動作戰卡對帳，不重複
- 「待補」流程：首頁提示、日誌待補區、詳情頁補資料表單
- 詳情頁 K 線圖（標進場、出場、止損、目標）
- 評分規則調整：進場當天（台北 24:00 前）補完理由就算有作戰卡

**不做：** BingX 以外的交易所、現貨、下單或改單（key 只讀）、背景排程（Vercel Hobby 的 cron 一天一次，不夠用；改成開 App 時同步）。

## 3. 架構

```
iPhone PWA ──(使用者的 Supabase JWT)──▶ Vercel 函數 /api/bingx/*（sin1 新加坡）
                                          ├─ 驗證 JWT，只允許 JOURNAL_OWNER_USER_ID
                                          ├─ 用唯讀 key 呼叫 open-api.bingx.com
                                          └─ 以「使用者的 JWT」寫入 Supabase（RLS 照常生效，不用 service role）
```

- 函數放在 `api/` 目錄（Vercel 對任何框架都支援），`vercel.json` 設 `"regions": ["sin1"]`：BingX／幣安會擋美國 IP。
- `vercel.json` 的 SPA rewrite 要排除 `/api/`。
- **為什麼要限定 owner**：Supabase 與 tradding_app 共用、公開註冊開著，任何註冊者都拿得到 JWT；不限定的話，別人能呼叫同步、把使用者的成交寫進他自己的帳號。
- 環境變數（只在 Vercel 伺服器端）：`BINGX_API_KEY`、`BINGX_SECRET_KEY`、`JOURNAL_OWNER_USER_ID`；Supabase URL／anon key 沿用 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。
- BingX key 必須**唯讀**（新建預設即唯讀，不要開交易與提幣）。

## 4. BingX API（2026-10-12 對照官方 `BingX-API/api-ai-skills` 文件）

| 用途 | 端點 | 備註 |
|---|---|---|
| 找出交易過的幣 | `GET /openApi/swap/v2/user/income`（不帶 symbol，`incomeType=TRADING_FEE`） | 只保留 3 個月 |
| 歷史倉位 | `GET /openApi/swap/v1/trade/positionHistory`（`symbol`、`startTs`、`endTs` 必填） | 區間最長 3 個月，pageSize ≤ 100 |
| 持倉中 | `GET /openApi/swap/v2/user/positions` | |
| 歷史訂單（止損單） | `GET /openApi/swap/v2/trade/allOrders`（`symbol` 必填） | `type`、`stopPrice`、`positionSide`、`status`，限速 1/s |
| K 線 | `GET /openApi/swap/v3/quote/klines`（`symbol`、`interval`、`startTime`、`endTime`、`limit`） | 公開端點，仍經函數轉發（避開 CORS） |

- Base URL：`https://open-api.bingx.com`（網路錯誤才退到 `.pro`）。
- 簽章：所有參數（含 `timestamp`）依 key 的 ASCII 排序後組成 `k=v&k=v`（不 URL 編碼），HMAC-SHA256(secret) 小寫 hex，附在 query 的 `signature`；header `X-BX-APIKEY`。
- 幣種格式 `BTC-USDT`；日誌內統一存成 `BTCUSDT`。
- **實作時第一步：用使用者的 key 實際呼叫，記錄 `positionHistory`、`allOrders` 的真實回應欄位，再寫對應程式。**文件沒有列出 positionHistory 每個欄位，不可以猜。

## 5. 資料模型變更（migration `2026-10-12-bingx.sql`）

```sql
alter table journal_trades
  add column source text not null default 'manual' check (source in ('manual', 'bingx')),
  add column external_id text,                 -- BingX positionId
  alter column planned_stop drop not null;     -- 匯入時沒有止損單 → 待補止損
create unique index journal_trades_external on journal_trades (user_id, external_id) where external_id is not null;
alter table journal_settings add column bingx_synced_at timestamptz;
```

- `planned_stop` 為 null 的交易是「待補止損」：**不進引擎、不進統計**（沒有 R），只出現在待補清單。程式在載入時切成兩組。
- 「待補資料」的定義：`source = 'bingx'` 且 `card_at is null`（還沒補理由），或 `planned_stop is null`。

## 6. 同步演算法（`/api/bingx/sync`）

1. 起點：`bingx_synced_at − 1 天`（重疊一天防漏）；第一次同步取 30 天前。上限 3 個月。
2. `income` 找出區間內有手續費的幣種，加上目前持倉中的幣種。
3. 每個幣種（`allOrders` 限速 1/s，逐一呼叫）：
   - `positionHistory` 取已平倉倉位；`positions` 取持倉中倉位。
   - `allOrders` 取這段時間的止損單（`STOP_MARKET`／`STOP`）。
4. 每個倉位推導：
   - 方向：`positionSide`（單向持倉模式時由開倉方向判斷）
   - 進場價＝平均開倉價、出場價＝平均平倉價、進出場時間、實際損益＝已實現損益＋手續費＋資金費（以 BingX 回報為準）
   - **初始止損**：倉位開倉後第一張同幣種、同方向的止損單觸發價
   - **移動止損**：之後每張新的止損單（新觸發價 ≠ 前一張）記一筆 `stop_edits`
   - **出場原因**：最後一筆平倉單是止損單 → `stop`；止盈單 → `target`；其他 → `other`（使用者可改）
5. 寫入（以 `external_id` upsert，重複同步不會重複）：
   - 已存在且使用者補過資料：只更新 BingX 來源欄位（價格、時間、損益、止損），**不覆蓋**使用者填的 setup、理由、情緒、復盤、目標、標籤。
   - **對帳手動紀錄**：同幣種、同方向，滿足其一就合併到那筆、不新增：
     - 待進場的作戰卡，`card_at` 在開倉前 12 小時內
     - 手動記的交易，`opened_at` 與開倉時間差 30 分鐘內、且還沒有 `external_id`
6. 更新 `bingx_synced_at`，回傳 `{ created, updated, merged, pendingStop }`。

**觸發**：App 開啟時，若距上次同步超過 5 分鐘就自動同步一次，完成後重新載入；日誌頁有「立即同步」按鈕。

## 7. 評分規則調整（使用者決定：晚上補也不扣分）

- **有作戰卡的判定**改為：`card_at` 早於「進場當天的台北 24:00」。
  - 適用所有交易（手動與匯入一致）。
  - 隔天以後才補：算補卡（+10 經驗值、作戰卡項 0 分、記 FOMO）。
- 進場當天還沒過完、尚未補卡：**不算違規、不顯示 FOMO**，評分標「暫定」。
- 補資料表單存檔時寫入 `card_at = now()`。

## 8. 畫面

- **首頁**：狀態異常區上方顯示「待補 N 筆」，點擊到日誌待補區。
- **日誌**：最上方「待補資料」區；右上「立即同步」與最後同步時間。
- **詳情頁**：
  - 待補時最上方是補資料表單：setup、進場理由、情緒、初始止損（沒抓到止損單時必填）、目標（選填）。
  - **K 線圖**：`lightweight-charts`，5 分／15 分／1 小時切換；進場前與出場後各留一段行情；標進場、出場、止損線、目標線、移動止損的時間點。
  - 匯入的交易標「BingX」，價格與時間欄位在編輯頁仍可改。
- **角色頁**：顯示「BingX 已連線 · 最後同步時間」。

## 9. 錯誤處理

- 同步失敗不擋 App：日誌頁顯示錯誤與重試按鈕，資料照舊顯示。
- BingX 回 `code != 0`：把 BingX 的錯誤訊息原文傳回前端顯示。
- 函數逐幣種處理，單一幣種失敗不影響其他幣種，回報中列出失敗的幣種。
- JWT 無效回 401；不是 owner 回 403。

## 10. 測試

- 純函數（vitest）：簽章字串組法（對照文件範例）、倉位→交易轉換、止損單→初始止損與 stop_edits、對帳規則（12 小時、30 分鐘的邊界）、當天補卡的評分邊界（23:59 與隔天 00:00）。
- 用使用者的真實 key 跑一次同步，逐筆對照 BingX App 的歷史倉位。
- iPhone 實機：開 App 自動同步、補資料、K 線圖。

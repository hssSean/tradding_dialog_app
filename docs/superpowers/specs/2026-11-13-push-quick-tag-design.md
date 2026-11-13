# 推播快速標記＋待標記收件匣 設計規格

2026-11-13，使用者核准（brainstorming）。

## 問題

DB 實測（2026-11-13）：BingX 同步與自動截圖照常運作，但 10-12 之後 67 筆交易的 setup／進場理由／筆記／錯誤標籤**全部是 0**（10-05 那週 28 筆裡還有 12 筆有理由）。
原因：使用者在 TradingView 看盤、切到交易所下單，事後不會再切到日誌 App。缺的只剩「只有使用者腦中才有的」那一塊——為什麼進、哪個 setup、有沒有照計畫。截圖已自動化，不是問題。

另一個缺口：同步只在開 App 時跑，不開 App 連資料都不進來。

## 目標

使用者不用主動切換：開倉／平倉後手機收到推播，點進去 **2～3 下**完成標記，不打字。沒點的推播累積在收件匣，檢討前一次清完。
看盤／下單裝置不固定（電腦、手機都有），所以觸發來源用 BingX（每筆交易最後一定在那），不綁裝置。

不做：電腦快捷鍵／TradingView 外掛（只涵蓋電腦，使用者沒選）。

## 架構

```
外部 cron（每 5 分鐘）
  └→ POST /api/notify/tick（header 帶 NOTIFY_CRON_SECRET）
       ├ BingX 唯讀 key：GET /openApi/swap/v2/user/positions（持倉中）
       │                 ＋ positionHistory（最近平倉，涵蓋最近 2 小時）
       ├ 與 journal_push_log 比對：沒推過的 open／close 事件才推
       ├ web-push 送到 journal_push_subscriptions
       └ 送出成功才寫 journal_push_log
  每天台北 22:00 那一輪另外：待標記 > 0 就推「今天 N 筆待標記」

使用者點推播 → 開 /tag/:positionKey
  ├ App 既有的自動同步（使用者 JWT 寫 journal_trades，K 線截圖照舊）
  └ 顯示快速標記卡；同步後仍找不到對應交易 → 轉到收件匣
```

### 權限（CLAUDE.md 規則改寫）

cron 執行時沒有使用者 JWT。決定：

- **交易寫入一律用使用者 JWT**——cron 不碰 `journal_trades`，只有 App 寫。
- cron 用 service role，**只**讀寫 `journal_push_subscriptions`、`journal_push_log`，且只限 `JOURNAL_OWNER_USER_ID`。
- CLAUDE.md 的「寫入一律用使用者 JWT，不用 service role」改成「**交易**寫入一律用使用者 JWT；service role 只用在推播的兩張表」。

原規則防的是「別人把擁有者的成交寫進自己帳號」，這個設計下仍不可能發生。

### Cron

Vercel Hobby 的 cron 一天一次，不夠。用外部 cron 服務（同 tradding_app 的做法）每 5 分鐘打一次。

## 資料表（migration，`journal_` 前綴）

```sql
create table journal_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
-- RLS：使用者只能 insert／select／delete 自己的（App 訂閱／取消用 JWT）

create table journal_push_log (
  user_id uuid not null references auth.users on delete cascade,
  event_key text not null,          -- 'open:<positionId>' | 'close:<positionId>' | 'daily:<YYYY-MM-DD>'
  sent_at timestamptz not null default now(),
  primary key (user_id, event_key)
);
-- RLS：使用者只能 select 自己的；寫入只有 service role
```

`journal_trades` 不加欄位。新增手動標籤 `late_exit`（抱太久）到 `MANUAL_TAG_LABELS`（`src/lib/trade.ts`）。
`positionId` 照 CLAUDE.md 的坑：超過 2^53，一律用 `parseBingxJson` 解析、以字串保存。

## 快速標記卡（推播頁與收件匣共用元件）

上方：自動產生的 K 線截圖（沒有就即時畫）。

### 開倉卡

| 列 | 選項 | 預設 | 寫入 |
|---|---|---|---|
| Setup | 訂單塊回踩／突破追勢／支撐壓力反轉／其他 | **無，必點** | `setup_id`（其他 = null） |
| 照計畫嗎 | 照計畫／臨時起意 | 照計畫 | 臨時起意 → `mistake_tags` 加 `unplanned` |
| 一句話 | 單行輸入（可用鍵盤語音輸入），選填 | 空 | `entry_reason` |

「完成」→ 寫 `card_at`（同既有補資料路徑 `db.ts`，當天補完就算有作戰卡，遊戲化不用改）。

### 平倉卡

| 列 | 選項 | 預設 | 寫入 |
|---|---|---|---|
| 出場 | 照計畫／提前跑／抱太久 | 照計畫 | `early_exit`／`late_exit` |
| 追價了嗎 | 沒有／有 | 沒有 | 有 → `chasing`（只在開倉沒標過時顯示） |
| 一句話 | 選填 | 空 | `note` |

開倉沒標過 → 平倉卡把開倉三列也帶上。「完成」→ 寫 `reviewed_at`（24h 內 = 檢討滿分，既有規則）；`card_at` 若為 null 也照補資料規則補上。

原則：最少 2 下（setup＋完成）、最多 3～4 下；不打字；不用 `alert/confirm/prompt`。

setup 清單用設定頁既有的 setup 管理；實作時預先建立「突破／追勢」「支撐壓力反轉」（已有「訂單塊回踩」）。

## 收件匣

- 首頁頂部一條「N 筆待標記」，點進去一張張快速標記卡，標完自動下一張。
- 待標記 = 已平倉且 `reviewed_at` 為 null，或持倉中且 `card_at` 為 null。只算 `gamified = true` 且有 `external_id` 的（BingX 匯入）。純函數 `src/lib/pending.ts`。
- 每日 22:00（台北）推播：cron 端也需要待標記數 → 在 tick 裡用 service role **唯讀** count `journal_trades`（owner 限定）。這是 service role 對 `journal_trades` 的唯一用途，只讀。

## 推播開關

- 設定頁「開啟推播」：未從主畫面開啟時提示「iOS 需先加到主畫面」。訂閱成功送一則測試推播。
- VAPID：新產生一組（`VAPID_PUBLIC_KEY`／`VAPID_PRIVATE_KEY`／`VAPID_SUBJECT`），不跟 tradding_app 共用，避免兩邊互相影響。前端用 `VITE_VAPID_PUBLIC_KEY`。
- Service worker：`vite-plugin-pwa` 改 `injectManifest`（或 `importScripts`）加 `push`、`notificationclick` 處理；點擊開 `data.url`。
- 依賴：`web-push`（伺服器端）。

## 錯誤處理

- BingX 讀取失敗：這輪跳過、不寫 log，下輪補推。
- 推播服務回 404／410：刪該訂閱；設定頁顯示「推播已失效，請重新開啟」。
- 同一事件只推一次（`journal_push_log` 主鍵）。順序：查 log 沒有 → 送出 → 成功才 insert（`on conflict do nothing`）。兩輪並行可能重複推一次，可接受（cron 5 分鐘一次，tick 遠短於此）。
- 首次啟用時不要把歷史倉位全推一遍：只推 `openTime`／`closeTime` 在最近 2 小時內的事件。
- cron 停了：不另外告警（收件匣是後備）。`journal_settings` 記 `last_tick_at`；App 開啟時超過 1 小時顯示一行灰字。
- 點推播但同步後找不到對應交易：轉到收件匣。

## 測試

- vitest 純函數：從 BingX 持倉／歷史抽出事件、事件去重、2 小時視窗、待標記判斷、卡片選項 → 欄位對應（含 `unplanned`／`early_exit`／`late_exit`／`chasing`）。
- `/api/notify/tick?dryRun=1`：回傳「會推什麼」，不送、不寫 log。
- 使用者 iPhone 實測：開一筆小倉 → 5 分鐘內收到推播 → 點進去 → 完成 → 平倉 → 收到平倉推播 → 完成；收件匣數字歸零。

## 使用者要做的

1. Supabase SQL Editor 跑 migration（或 `sb-query.mjs`，目前 token 失效要更新 `SUPABASE_ACCESS_TOKEN`）。
2. Vercel 加環境變數：`SUPABASE_SERVICE_ROLE_KEY`、`NOTIFY_CRON_SECRET`、VAPID 三個、`VITE_VAPID_PUBLIC_KEY`；設完逐一確認。
3. 外部 cron 加一個每 5 分鐘的任務打 `/api/notify/tick`。
4. iPhone 從主畫面開 App → 設定 → 開啟推播。

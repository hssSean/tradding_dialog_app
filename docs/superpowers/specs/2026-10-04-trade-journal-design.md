# 手動交易紀錄 App — 設計規格

日期：2026-10-04
狀態：已核准設計，待寫實作計畫

## 1. 目的

記錄使用者自己的**手動**交易，每週檢討時能直接回答「問題出在哪」。
重點三類：**紀律問題**、**策略／setup 表現**、**時段／幣種／方向**。

主要裝置是 iPhone（加入主畫面的 PWA），電腦瀏覽器也能用，資料走雲端同步。

## 2. 範圍

**做：**
- 兩段式記錄：進場時填計畫、出場時填結果
- 一筆交易一進一出，不分批
- 每筆交易最多附兩張截圖：進場一張、出場一張，上傳前先在手機上壓縮
- 每週檢討頁：摘要、本週最大問題、分組統計、每週心得
- 單一使用者，email＋密碼登入

**不做（YAGNI）：** 交易所 API 匯入、分批進出／加倉、情緒標籤、推播、多使用者、離線模式、匯出。

## 3. 技術架構

- 前端：Vite + React + TypeScript + Tailwind + React Router + `vite-plugin-pwa`
- 後端：**與 `tradding_app` 共用**同一個 Supabase 專案與登入帳號（2026-10-05 變更，原本是新建專案）。本專案所有資料表、函數、policy、bucket 一律加 `journal_` 前綴，避免與 tradding_app 的 `trades` 等表衝突。下文的表名省略前綴，實際名稱見 `supabase/schema.sql`
- 部署：Vercel 免費方案，純靜態網站，沒有伺服器端程式
- 權限：所有資料表與 Storage 都靠 RLS，只能存取 `auth.uid()` 自己的資料
- 時區：固定 `Asia/Taipei`，寫成常數，不開設定

### 模組切分

| 模組 | 職責 | 依賴 |
|---|---|---|
| `src/lib/trade.ts` | 純函數：輸入驗證、R 計算、紀律警示、估算損益 | 無 |
| `src/lib/stats.ts` | 純函數：週次切分、篩選、分組統計、最大問題歸因、乾淨 vs 犯錯 | `trade.ts` |
| `src/lib/image.ts` | 截圖縮放與 JPEG 編碼 | 瀏覽器 Canvas API |
| `src/lib/db.ts` | 唯一呼叫 Supabase 的地方，負責 CRUD 與上傳／簽名網址 | `supabase-js` |
| `src/lib/draft.ts` | 表單草稿暫存在 localStorage，並負責還原 | 無 |
| `src/pages/*` | 列表、新增（進場）、平倉、詳情／編輯、每週檢討、設定、登入 | 上面所有模組 |

畫面元件不直接 import `supabase-js`。

## 4. 資料模型

```sql
-- 使用者設定
create table settings (
  user_id uuid primary key references auth.users on delete cascade,
  standard_risk_usdt numeric not null default 10 check (standard_risk_usdt > 0),
  updated_at timestamptz not null default now()
);

-- 使用者自訂 setup 清單
create table setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- 進場（計畫）
  symbol text not null,                       -- 一律存大寫，例如 BTCUSDT
  direction text not null check (direction in ('long','short')),
  setup_id uuid references setups on delete set null,
  timeframe text,                              -- 例如 15m、1h、4h
  opened_at timestamptz not null,
  entry_price numeric not null check (entry_price > 0),
  planned_stop numeric not null check (planned_stop > 0),
  planned_target numeric check (planned_target > 0),
  risk_usdt numeric not null check (risk_usdt > 0),
  entry_reason text,
  -- 出場（結果），未平倉時為 null
  closed_at timestamptz,
  exit_price numeric check (exit_price > 0),
  final_stop numeric check (final_stop > 0),  -- 平倉前最後的止損價，預設等於 planned_stop
  exit_reason text check (exit_reason in ('target','stop','manual_plan','manual_early','other')),
  pnl_usdt numeric,                            -- 選填，實際損益（含手續費）
  mistake_tags text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((closed_at is null) = (exit_price is null)),
  check (closed_at is null or exit_reason is not null)
);
create index on trades (user_id, closed_at desc);
create index on trades (user_id, opened_at desc);

create table trade_images (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('entry','exit')),
  path text not null,                          -- Storage 內路徑
  size_bytes int not null,
  created_at timestamptz not null default now(),
  unique (trade_id, kind)                      -- 進場、出場各最多一張
);

create table weekly_reviews (
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,                    -- 該週週一（台北日期）
  note text,                                   -- 本週檢討
  next_week_focus text,                        -- 下週要改的事
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
```

- 每張表都開 RLS，`select/insert/update/delete` 的條件一律是 `user_id = auth.uid()`。
- Storage bucket `journal-screenshots` 設為**私有**，路徑格式 `{user_id}/{trade_id}/{kind}.jpg`。policy 限制路徑第一段等於 `auth.uid()`。顯示圖片時用 1 小時效期的簽名網址。
- 第一次登入時，若沒有 `settings` 列就自動建立一列預設值。
- 刪除交易時，先刪 Storage 檔案，再刪 `trades` 列（`trade_images` 會跟著 cascade 刪除）。

## 5. 計算規則（`trade.ts`）

設 `sign = direction === 'long' ? 1 : -1`。

- **計畫風險距離** `riskDist = (entry_price − planned_stop) × sign`，必須 > 0。
- **R 倍數** `R = (exit_price − entry_price) × sign ÷ riskDist`，取到小數點後兩位。
- **計畫 R:R** `= (planned_target − entry_price) × sign ÷ riskDist`，只在有目標價時計算。
- **損益**：`pnl_usdt` 有填就用；沒填就用 `R × risk_usdt`，並標記為「估算」。

### 輸入驗證（違反時擋下送出，並顯示原因）

- 做多：`planned_stop < entry_price`；若有目標，`planned_target > entry_price`。做空時方向相反。
- `risk_usdt > 0`，`exit_price > 0`。
- `closed_at ≥ opened_at`。
- `final_stop` 可以在進場價的任一側（移到保本或更有利的位置是合法的）。

### 紀律鍵（discipline keys）

統計時，每筆已平倉交易的紀律鍵 = **手動標籤 ∪ 自動警示**（去重）。同一件事只有一個標準鍵，手動勾選和自動偵測到的會合併算一次。

| 標準鍵 | 顯示名稱 | 自動偵測條件 |
|---|---|---|
| `stop_widened` | 移遠止損 | `(entry_price − final_stop) × sign > riskDist × 1.0001` |
| `early_exit` | 提前出場 | `exit_reason = 'manual_early'` |
| `stop_not_honored` | 沒守止損 | `R < −1.1` |
| `oversized` | 超額倉位 | `risk_usdt > standard_risk_usdt × 1.5`（用**統計當下**的設定值） |
| `revenge` | 報復單 | 本筆 `opened_at` 落在另一筆 `R < 0` 交易的 `closed_at` 之後 0–30 分鐘內 |
| `no_stop` | 沒設止損 | 只能手動勾選 |
| `chasing` | 追價 | 只能手動勾選 |
| `unplanned` | 計畫外交易 | 只能手動勾選 |
| 自訂字串 | 原樣顯示 | 只能手動輸入 |

- `revenge` 需要整份交易清單才能判斷，所以放在 `stats.ts` 裡算，不在單筆函數裡。
- 平倉表單送出前會先預覽自動警示，讓使用者看到系統抓到了什麼。

## 6. 統計規則（`stats.ts`）

- **週次**：台北時間週一 00:00 到下週一 00:00（不含）。一筆交易**以 `closed_at` 歸週**；未平倉的交易不進任何統計。
- **時段**：用台北時間的 `opened_at` 分 6 段：00–04、04–08、08–12、12–16、16–20、20–24。另外依星期幾分組。
- **每組指標**：筆數 n、勝率（R > 0 才算勝）、平均 R、總 R、損益 USDT 合計。
- **範圍切換**：本週／近 4 週（含本週）／全部。
- **樣本警示**：n < 5 的組灰字顯示，並標上「樣本太少」。

### 本週摘要

筆數、勝率、總 R、平均 R、損益 USDT。比較基準有兩個：上週總 R，以及前 4 週（不含本週）每週總 R 的平均。

### 本週最大問題

1. 候選組 = 所有紀律鍵、setup、幣種、方向、時段，只取本週的資料。
2. 每組算總 R，挑**總 R 最負**的一組。同分時依序優先：紀律鍵 > setup > 幣種 > 時段 > 方向。
3. 顯示內容：組名、n、總 R、佔比。佔比 = `|組總 R| ÷ |本週所有 R < 0 交易的 R 合計|`，上限 100%。
4. 沒有任何組的總 R < 0 時，顯示「本週沒有虧損來源」。

### 乾淨 vs 犯錯

把本週交易依「有沒有任何紀律鍵」分成兩組，各自顯示 n、總 R、平均 R。
另外加一句：「若沒有犯錯單，本週總 R 為 X」，X = 乾淨組的總 R。

## 7. 畫面

- **登入**：email＋密碼，登入狀態長期保留。不用 magic link，原因是 iPhone 主畫面 PWA 跟 Safari 分開儲存，點信裡的連結會在 Safari 登入，而不是在 App 裡。
- **交易列表**（首頁）：最上方是未平倉區塊，每筆有「平倉」按鈕；下面是已平倉列表，依 `closed_at` 由新到舊，每列顯示幣種、方向、R、紀律警示圖示。右下角有「＋」新增。
- **新增（進場）**：欄位依第 4 節。幣種自動補全最近用過的 10 個；開倉時間預設現在；風險金額預設帶入標準風險；可附進場截圖。
- **平倉**：出場價、出場時間（預設現在）、最後止損（預設帶入計畫止損）、出場原因、實際損益（選填）、犯錯標籤、心得、出場截圖。送出前預覽 R 與自動警示。
- **交易詳情**：顯示全部欄位、兩張截圖（點擊放大）、R、紀律鍵。可以編輯、刪除；刪除前要確認。
- **每週檢討**：週次左右切換；依序是摘要、最大問題卡片、乾淨 vs 犯錯、分組表（紀律／setup／幣種／方向／時段／星期，可切換範圍）、心得框。心得框上方顯示上週寫的「下週要改的事」。
- **設定**：標準風險金額、setup 清單（新增、改名、封存、排序）、截圖儲存用量（`trade_images.size_bytes` 加總 ÷ 1GB）、登出。

手機版面優先，單欄排版，觸控目標至少 44px，並處理 iPhone 的安全區域（瀏海、底部橫條）。

## 8. 截圖壓縮（`image.ts`）

1. 用 `<input type="file" accept="image/*">` 選圖。iOS 選相簿裡的 HEIC 照片時會自動轉成 JPEG 交給網頁。
2. 用 `createImageBitmap` 解碼，等比縮放到**最長邊 ≤ 2000px**；原圖本來就比較小時不放大。
3. 畫到 canvas，再用 `toBlob('image/jpeg', 0.8)` 輸出。
4. 防呆：如果輸出的 `blob.type` 不是 `image/jpeg`，就丟出錯誤，不上傳。
5. 預期每張 250–400KB，1GB 約可存 3000 張。

不用 WebP：iOS Safari 的 canvas 不支援輸出 WebP，會悄悄改輸出 PNG，檔案反而更大。
不縮到 1600px 以下：直式截圖會讓 K 線圖上的價格刻度文字變得無法辨識。

## 9. 錯誤處理

- 表單每次修改都把草稿存進 localStorage，key 是 `draft:new` 或 `draft:close:{tradeId}`。送出成功後清除。重開時如果有草稿，就問使用者要不要還原。所有 localStorage 存取都包在 try/catch 裡。
- 網路或 Supabase 錯誤時，顯示錯誤訊息，表單內容保留不清空。
- 截圖上傳失敗時，交易照樣存檔，詳情頁顯示「截圖未上傳，重試」。
- Session 過期時，導回登入頁；草稿因為存在 localStorage，不會遺失。

## 10. 測試

- 用 vitest 測所有純函數：
  - `trade.ts`：多空 R 計算、計畫 R:R、輸入驗證每一條規則、每個自動警示的邊界值（例如 −1.1R 剛好等於與略低、`stop_widened` 的容差）、估算損益。
  - `stats.ts`：台北時間週邊界（週日 23:59 與週一 00:00、跨年週）、時段分段、`revenge` 的 0／30／31 分鐘、最大問題的同分優先順序、佔比上限、沒有虧損的週、乾淨 vs 犯錯。
  - `image.ts`：縮放尺寸計算抽成純函數來測；編碼本身在 iPhone 實機驗證。
- 型別檢查 `tsc --noEmit`、`vite build` 都要通過。
- 在 iPhone 實機驗證：加入主畫面、登入後保持登入、新增→平倉→檢討完整流程、截圖上傳與顯示。

## 11. 部署

- 在 tradding_app 的 Supabase 專案執行 `supabase/schema.sql`（資料表、RLS、Storage bucket 與 policy）。
- 環境變數 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 設在 Vercel；anon key 本來就是公開的，安全性由 RLS 保證。
- **不關閉**公開註冊：tradding_app 需要註冊功能。其他註冊者受 RLS 限制，只看得到自己的資料。

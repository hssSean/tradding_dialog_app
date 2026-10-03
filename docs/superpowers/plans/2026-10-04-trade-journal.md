# 手動交易紀錄 App 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 `docs/superpowers/specs/2026-10-04-trade-journal-design.md` 做出可在 iPhone 加入主畫面使用的手動交易紀錄 PWA。

**Architecture:** 純前端 SPA（Vite + React + TS），資料、登入、截圖全走 Supabase（RLS 保護），部署到 Vercel 靜態網站。所有計算（R、紀律警示、週統計、歸因）都是 `src/lib/` 裡的純函數，用 vitest 測；畫面只透過 `src/lib/db.ts` 存取 Supabase。

**Tech Stack:** Vite 8、React 19、TypeScript、Tailwind CSS 4（`@tailwindcss/vite`）、React Router 7、`vite-plugin-pwa` 2、`@supabase/supabase-js` 2、vitest 5。

## Global Constraints

- 時區固定 `Asia/Taipei`（UTC+8、無日光節約），常數 `TZ`。
- 週次：台北時間週一 00:00 起算，以 `closed_at` 歸週；未平倉不進統計。
- 截圖：最長邊 ≤ 2000px、`image/jpeg` 品質 0.8；輸出非 JPEG 時丟錯不上傳。
- 登入：email＋密碼，不用 magic link。
- 樣本警示門檻：n < 5。
- 紀律門檻：`stop_widened` 容差 1.0001、`stop_not_honored` R < −1.1、`oversized` > 標準風險 × 1.5、`revenge` 0–30 分鐘（含 30）。
- 介面文字一律繁體中文；手機優先、觸控目標 ≥ 44px、處理 safe-area。
- 所有 localStorage 存取包 try/catch。
- 畫面元件不直接 import `@supabase/supabase-js`。

## 檔案結構

```
index.html                     # iOS PWA meta、viewport-fit=cover
vite.config.ts                 # react、tailwind、PWA manifest、vitest 設定
public/icon.svg                # 來源圖示；pwa-*.png 與 apple-touch-icon 由 assets-generator 產生
supabase/schema.sql            # 資料表、RLS、Storage bucket 與 policy
src/main.tsx                   # 掛載 + Router
src/index.css                  # Tailwind 匯入、safe-area 工具類
src/lib/types.ts               # 資料型別
src/lib/trade.ts               # 單筆計算與驗證（純）
src/lib/stats.ts               # 週次、分組、歸因（純）
src/lib/format.ts              # 顯示格式、datetime-local 轉換（純）
src/lib/image.ts               # fitSize（純）+ compressImage
src/lib/draft.ts               # localStorage 草稿
src/lib/db.ts                  # Supabase 存取（唯一入口）
src/lib/useAsync.ts            # 載入狀態小 hook
src/components/Layout.tsx      # 底部分頁列 + safe-area
src/components/AuthGate.tsx    # 未登入顯示登入頁
src/components/EntryFields.tsx # 進場欄位（新增／編輯共用）
src/components/ExitFields.tsx  # 出場欄位（平倉／編輯共用）
src/components/ImagePicker.tsx # 選圖→壓縮→預覽
src/components/StatsTable.tsx  # 分組表
src/pages/Login.tsx
src/pages/TradeList.tsx
src/pages/NewTrade.tsx
src/pages/CloseTrade.tsx
src/pages/TradeDetail.tsx
src/pages/EditTrade.tsx
src/pages/WeeklyReview.tsx
src/pages/Settings.tsx
tests/trade.test.ts
tests/stats.test.ts
tests/format.test.ts
tests/image.test.ts
tests/draft.test.ts
```

---

### Task 1：專案骨架與 PWA

**Files:** Create `package.json`、`vite.config.ts`、`tsconfig*.json`、`index.html`、`src/main.tsx`、`src/index.css`、`public/icon.svg`、`tests/smoke.test.ts`

- [ ] `npm create vite@latest . -- --template react-ts`（目錄已有檔案時保留 `docs/`、`CLAUDE.md`）
- [ ] 安裝：`npm i @supabase/supabase-js react-router-dom`、`npm i -D tailwindcss @tailwindcss/vite vite-plugin-pwa vitest @vite-pwa/assets-generator`
- [ ] `vite.config.ts`：plugins `react()`、`tailwindcss()`、`VitePWA({ registerType: 'autoUpdate', manifest: { name: '交易日誌', short_name: '交易日誌', display: 'standalone', background_color: '#09090b', theme_color: '#09090b', lang: 'zh-TW', icons: [...] } })`；`test: { include: ['tests/**/*.test.ts'] }`
- [ ] `index.html`：`lang="zh-Hant"`、`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`、`apple-mobile-web-app-capable`、`apple-mobile-web-app-status-bar-style=black-translucent`、`apple-touch-icon`
- [ ] `public/icon.svg` → `npx pwa-assets-generator --preset minimal-2023 public/icon.svg` 產生 PNG
- [ ] `package.json` scripts：`"test": "vitest run"`、`"typecheck": "tsc -b --noEmit"`
- [ ] 驗證：`npm test`（smoke 測試 `expect(1).toBe(1)` 通過）、`npm run build` 成功且 `dist/manifest.webmanifest` 存在
- [ ] Commit `chore: Vite + React + Tailwind + PWA 骨架`

### Task 2：型別與單筆計算（`types.ts`、`trade.ts`）

**Interfaces（Produces）：**

```ts
// types.ts
export type Direction = 'long' | 'short';
export type ExitReason = 'target' | 'stop' | 'manual_plan' | 'manual_early' | 'other';
export interface Trade {
  id: string; user_id: string; symbol: string; direction: Direction;
  setup_id: string | null; timeframe: string | null; opened_at: string;
  entry_price: number; planned_stop: number; planned_target: number | null;
  risk_usdt: number; entry_reason: string | null;
  closed_at: string | null; exit_price: number | null; final_stop: number | null;
  exit_reason: ExitReason | null; pnl_usdt: number | null;
  mistake_tags: string[]; note: string | null; created_at: string; updated_at: string;
}
export type ClosedTrade = Trade & { closed_at: string; exit_price: number; exit_reason: ExitReason };
export interface EntryInput { symbol: string; direction: Direction; setup_id: string | null; timeframe: string | null; opened_at: string; entry_price: number; planned_stop: number; planned_target: number | null; risk_usdt: number; entry_reason: string | null }
export interface ExitInput { closed_at: string; exit_price: number; final_stop: number; exit_reason: ExitReason; pnl_usdt: number | null; mistake_tags: string[]; note: string | null }
export interface Setup { id: string; user_id: string; name: string; archived: boolean; sort_order: number }
export interface Settings { user_id: string; standard_risk_usdt: number }
export type ImageKind = 'entry' | 'exit';
export interface TradeImage { id: string; trade_id: string; user_id: string; kind: ImageKind; path: string; size_bytes: number }
export interface WeeklyReview { user_id: string; week_start: string; note: string | null; next_week_focus: string | null }

// trade.ts
export const TZ = 'Asia/Taipei';
export const DISCIPLINE_LABELS: Record<string, string>; // stop_widened 移遠止損、early_exit 提前出場、stop_not_honored 沒守止損、oversized 超額倉位、revenge 報復單、no_stop 沒設止損、chasing 追價、unplanned 計畫外交易
export const MANUAL_TAG_KEYS: string[]; // ['stop_widened','early_exit','no_stop','revenge','oversized','chasing','unplanned']
export const EXIT_REASON_LABELS: Record<ExitReason, string>; // 打到目標、打到止損、照計畫手動、提前手動、其他
export function isClosed(t: Trade): t is ClosedTrade;
export function riskDistance(t: Pick<Trade,'direction'|'entry_price'|'planned_stop'>): number;
export function rMultiple(t: ClosedTrade): number;            // 四捨五入到 0.01
export function plannedRR(t: Pick<Trade,'direction'|'entry_price'|'planned_stop'|'planned_target'>): number | null;
export function tradePnl(t: ClosedTrade): { value: number; estimated: boolean };
export function validateEntry(e: EntryInput): string[];      // 空陣列 = 通過
export function validateExit(t: Pick<Trade,'opened_at'>, x: ExitInput): string[];
export function autoFlags(t: ClosedTrade, standardRisk: number): string[]; // 不含 revenge
export function tagLabel(key: string): string;               // 未知鍵原樣回傳
export function normalizeSymbol(s: string): string;          // trim + 大寫
```

**測試案例（`tests/trade.test.ts`）：**
- 做多 entry 100 stop 95 exit 110 → R 2；做空 entry 100 stop 105 exit 90 → R 2；做多 exit 95 → −1
- `plannedRR` 做多 target 115 → 3；無 target → null
- `tradePnl`：有 `pnl_usdt` 12.5 → {12.5, false}；無 → R × risk，estimated true
- `validateEntry`：做多 stop ≥ entry 擋；做空 stop ≤ entry 擋；做多 target ≤ entry 擋；risk ≤ 0 擋；symbol 空擋；合法回 []
- `validateExit`：closed_at < opened_at 擋；exit_price ≤ 0 擋
- `autoFlags`：final_stop 等於 planned → 無；做多 final_stop 94 → `stop_widened`；做多 final_stop 101（保本以上）→ 無；R −1.1 → 無、R −1.11 → `stop_not_honored`；risk 15 / 標準 10 → 無、15.01 → `oversized`；exit_reason manual_early → `early_exit`
- `tagLabel('revenge')` → '報復單'；`tagLabel('自訂X')` → '自訂X'

- [ ] 寫測試 → 跑 `npm test` 確認失敗 → 實作 → 通過 → commit `feat: 單筆交易計算與驗證`

### Task 3：週次與分組統計（`stats.ts` 第一部分）、顯示格式（`format.ts`）

**Interfaces（Produces）：**

```ts
export interface Enriched { trade: ClosedTrade; r: number; pnl: number; pnlEstimated: boolean; keys: string[] }
export interface GroupStats { n: number; wins: number; winRate: number; totalR: number; avgR: number; pnl: number }
export type Dimension = 'discipline' | 'setup' | 'symbol' | 'direction' | 'hour' | 'weekday';
export interface GroupRow { key: string; label: string; stats: GroupStats; lowSample: boolean }
export type Scope = 'week' | '4w' | 'all';
export const LOW_SAMPLE = 5;
export function weekStartOf(d: Date | string): string;            // 'YYYY-MM-DD'（台北週一）
export function addWeeks(weekStart: string, n: number): string;
export function weekBounds(weekStart: string): { start: Date; end: Date }; // [start, end)
export function hourBucket(iso: string): string;                  // '00–04' … '20–24'（台北）
export function weekdayLabel(iso: string): string;                // '週一' … '週日'（台北）
export function revengeIds(trades: Trade[]): Set<string>;
export function enrich(trades: Trade[], standardRisk: number): Enriched[]; // 只回已平倉
export function inScope(list: Enriched[], scope: Scope, weekStart: string): Enriched[];
export function summarize(list: Enriched[]): GroupStats;
export function groupBy(list: Enriched[], dim: Dimension, setupNames: Map<string, string>): GroupRow[]; // 依 totalR 由小到大
```

`format.ts`：`fmtR(r)` → `+1.25R`／`−0.50R`；`fmtUsdt(v)` → `+12.30`；`fmtPct(x)` → `45%`；`fmtDateTime(iso)` 台北 `MM/DD HH:mm`；`toLocalInput(iso)` / `fromLocalInput(str)`（`datetime-local` 與 ISO 互轉，以台北時間解讀）；`weekTitle(weekStart)` → `10/05–10/11`。

**測試案例：**
- `weekStartOf('2026-10-04T15:59:00Z')`（台北週日 23:59）→ `'2026-09-28'`；`'2026-10-04T16:00:00Z'`（台北週一 00:00）→ `'2026-10-05'`
- 跨年：`weekStartOf('2027-01-01T04:00:00Z')` → `'2026-12-28'`；`addWeeks('2026-12-28', 1)` → `'2027-01-04'`
- `weekBounds('2026-10-05').start.toISOString()` → `'2026-10-04T16:00:00.000Z'`
- `hourBucket('2026-10-04T19:59:00Z')`（台北 03:59）→ `'00–04'`；`'2026-10-04T20:00:00Z'` → `'04–08'`
- `revengeIds`：A 虧損於 10:00 平倉，B 10:30 開 → 含 B；10:31 開 → 不含；A 獲利 → 不含
- `enrich`：未平倉被排除；`keys` 合併手動標籤與自動警示並去重（手動 `stop_widened` + 自動 `stop_widened` 只出現一次）；revenge 進 keys
- `summarize`：R [2, −1, 0] → n 3、wins 1、totalR 1、avgR 0.33
- `groupBy('discipline')`：沒有鍵的交易不出現；一筆兩鍵出現在兩組；n<5 → lowSample
- `groupBy('setup')`：`setup_id` null → label `未分類`
- `fmtR(-0.5)` → `−0.50R`；`fromLocalInput('2026-10-05T00:00')` → `'2026-10-04T16:00:00.000Z'`

- [ ] 寫測試 → 失敗 → 實作 → 通過 → commit `feat: 週次與分組統計`

### Task 4：最大問題與乾淨 vs 犯錯（`stats.ts` 第二部分）

```ts
export interface Problem { dimension: Dimension; label: string; n: number; totalR: number; share: number }
export function biggestProblem(week: Enriched[], setupNames: Map<string, string>): Problem | null;
export function cleanVsFlagged(list: Enriched[]): { clean: GroupStats; flagged: GroupStats };
export function weekSummary(all: Enriched[], weekStart: string): { current: GroupStats; prevTotalR: number; avg4TotalR: number };
```

規則照規格第 6 節：候選維度 discipline > setup > symbol > hour > direction（同分優先序）；share = |組總 R| ÷ |本週虧損單 R 合計|，上限 1；無負組回 null。`avg4TotalR` = 本週前 4 週（不含本週）每週總 R 平均，沒交易的週算 0。

**測試案例：**
- 報復單 2 筆各 −1，另一 setup 共 −2 → 同分選 discipline `報復單`
- share 上限：只有一組 −3 但虧損單合計 −2（因組含獲利單抵銷不會超過，構造重疊情況）→ ≤ 1
- 全部 R > 0 → null
- `cleanVsFlagged`：有鍵 / 無鍵正確分流
- `weekSummary`：前 4 週總 R [1, 0, −2, 3] → avg 0.5；上週總 R 正確

- [ ] 寫測試 → 失敗 → 實作 → 通過 → commit `feat: 本週最大問題歸因`

### Task 5：截圖壓縮與草稿（`image.ts`、`draft.ts`）

```ts
// image.ts
export const MAX_EDGE = 2000; export const JPEG_QUALITY = 0.8;
export function fitSize(w: number, h: number, max?: number): { width: number; height: number };
export async function compressImage(file: File): Promise<Blob>; // 輸出非 image/jpeg 時 throw
// draft.ts
export function loadDraft<T>(key: string): T | null;
export function saveDraft(key: string, value: unknown): void;
export function clearDraft(key: string): void;
```

**測試案例：** `fitSize(1179, 2556)` → `{ width: 923, height: 2000 }`；`fitSize(800, 600)` → 不變；`fitSize(4000, 3000)` → `{2000, 1500}`。草稿：存讀往返；`localStorage.getItem` 丟錯時 `loadDraft` 回 null 不丟錯；JSON 壞掉回 null。

- [ ] 寫測試 → 失敗 → 實作 → 通過 → commit `feat: 截圖壓縮與表單草稿`

### Task 6：Supabase schema 與資料存取（`schema.sql`、`db.ts`）

- [ ] `supabase/schema.sql`：規格第 4 節的五張表 + `updated_at` trigger + 每張表 RLS（`user_id = auth.uid()`）+ `insert into storage.buckets (id, name, public) values ('screenshots','screenshots',false)` + storage.objects 的四個 policy（`bucket_id='screenshots' and (storage.foldername(name))[1] = auth.uid()::text`）
- [ ] `.env.example`：`VITE_SUPABASE_URL=`、`VITE_SUPABASE_ANON_KEY=`
- [ ] `db.ts` 介面：

```ts
export function onAuthChange(cb: (signedIn: boolean) => void): () => void;
export async function isSignedIn(): Promise<boolean>;
export async function signIn(email: string, password: string): Promise<void>;
export async function signOut(): Promise<void>;
export async function getSettings(): Promise<Settings>;           // 沒有就建立預設
export async function updateSettings(standardRisk: number): Promise<void>;
export async function listSetups(): Promise<Setup[]>;             // 依 sort_order
export async function createSetup(name: string): Promise<Setup>;
export async function updateSetup(id: string, patch: Partial<Pick<Setup,'name'|'archived'|'sort_order'>>): Promise<void>;
export async function listTrades(): Promise<Trade[]>;
export async function getTrade(id: string): Promise<Trade>;
export async function createTrade(e: EntryInput): Promise<Trade>;
export async function closeTrade(id: string, x: ExitInput): Promise<Trade>;
export async function updateTrade(id: string, patch: Partial<EntryInput & ExitInput>): Promise<Trade>;
export async function deleteTrade(id: string): Promise<void>;     // 先刪 Storage 再刪列
export async function listImages(tradeId: string): Promise<TradeImage[]>;
export async function uploadImage(tradeId: string, kind: ImageKind, blob: Blob): Promise<void>; // upsert 檔案與列
export async function imageUrl(path: string): Promise<string>;    // 3600 秒簽名網址
export async function storageUsageBytes(): Promise<number>;
export async function getWeeklyReview(weekStart: string): Promise<WeeklyReview | null>;
export async function saveWeeklyReview(weekStart: string, note: string, nextWeekFocus: string): Promise<void>;
```

- [ ] 驗證：`npm run typecheck` 通過 → commit `feat: Supabase schema 與資料存取層`

### Task 7：登入、版面、路由

- [ ] `AuthGate`：`isSignedIn` + `onAuthChange`；未登入顯示 `Login`（email、密碼、錯誤訊息）
- [ ] `Layout`：內容區 + 底部分頁列（交易 `/`、檢討 `/review`、設定 `/settings`），`pb-[env(safe-area-inset-bottom)]`、`pt-[env(safe-area-inset-top)]`
- [ ] 路由：`/`、`/new`、`/trade/:id`、`/trade/:id/close`、`/trade/:id/edit`、`/review`、`/review/:week`、`/settings`
- [ ] `useAsync<T>(fn, deps)` → `{ data, error, loading, reload }`
- [ ] 驗證：typecheck、build；commit `feat: 登入與版面`

### Task 8：交易列表與新增

- [ ] `TradeList`：未平倉區（每筆有「平倉」按鈕）＋已平倉列表（依 `closed_at` 由新到舊，顯示幣種、方向、`fmtR`、有紀律鍵時顯示 ⚠ 與數量）＋右下「＋」
- [ ] `EntryFields`：受控元件 `value: EntryForm`（全部字串欄位）、`onChange`；幣種用 `<datalist>` 列最近 10 個；數字欄 `inputMode="decimal"`；setup 下拉（不含封存）
- [ ] `NewTrade`：草稿 key `draft:new`、預設 opened_at 現在、risk 帶標準風險；送出前 `validateEntry`，錯誤列在按鈕上方；成功後上傳進場截圖（失敗不擋）、清草稿、導到 `/`
- [ ] 驗證：typecheck、build；commit `feat: 交易列表與新增`

### Task 9：平倉、詳情、編輯、刪除

- [ ] `ExitFields`：出場價、出場時間、最後止損、出場原因、實際損益（選填）、犯錯標籤（`MANUAL_TAG_KEYS` 勾選＋自訂輸入）、心得
- [ ] `CloseTrade`：草稿 key `draft:close:{id}`；送出前預覽 R 與 `autoFlags`；`validateExit`；成功後上傳出場截圖
- [ ] `TradeDetail`：所有欄位、R、計畫 R:R、損益（估算標註）、紀律鍵（含 revenge，需 `listTrades` 算 `revengeIds`）、截圖（點擊全螢幕）、缺圖時「上傳截圖」按鈕、編輯、刪除（`confirm`）
- [ ] `EditTrade`：`EntryFields` +（已平倉時）`ExitFields`，用 `updateTrade`
- [ ] 驗證：typecheck、build；commit `feat: 平倉、詳情與編輯`

### Task 10：每週檢討頁

- [ ] `WeeklyReview`：週次（URL `:week`，預設本週）左右切換；摘要（n、勝率、總 R、平均 R、損益，對比上週與前 4 週平均）；最大問題卡片；乾淨 vs 犯錯（「若沒有犯錯單，本週總 R 為 X」）；範圍切換（本週／近 4 週／全部）＋六個維度 `StatsTable`（lowSample 灰字＋「樣本太少」）；上週「下週要改的事」；本週心得兩個文字框（離開焦點自動存）
- [ ] 驗證：typecheck、build；commit `feat: 每週檢討頁`

### Task 11：設定頁

- [ ] 標準風險（存檔按鈕）；setup 清單（新增、改名、封存／取消封存、上下移動）；儲存用量 `X MB / 1024 MB`；登出
- [ ] 驗證：typecheck、build；commit `feat: 設定頁`

### Task 12：部署說明與最終驗證

- [ ] `README.md`：Supabase 建專案 → 跑 `schema.sql` → 建使用者 → 關閉 signups；Vercel 匯入 repo、設環境變數；iPhone「加入主畫面」
- [ ] `npm test`、`npm run typecheck`、`npm run build` 全過
- [ ] Commit、push

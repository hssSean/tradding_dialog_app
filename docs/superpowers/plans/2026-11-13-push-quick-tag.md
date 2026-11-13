# 推播快速標記＋待標記收件匣 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BingX 開倉／平倉後推播到 iPhone，點進去 2～3 下標記 setup／照計畫／出場；沒點的進收件匣。

**Architecture:** 外部 cron 每 5 分鐘打 `/api/notify/tick`（service role 只碰推播兩張表＋唯讀計數），用 BingX 唯讀 key 找新事件、web-push 推送。點推播開 `/tag/open|close/:positionId`，App 用使用者 JWT 同步與寫入。事件偵測、卡片欄位對應、待標記判斷全是純函數（前後端共用、vitest）。

**Tech Stack:** Vite + React 19 + TS、Vercel functions（Web `Request` handler）、Supabase、`web-push`、`vite-plugin-pwa`（workbox `importScripts`）。

規格：`docs/superpowers/specs/2026-11-13-push-quick-tag-design.md`

## Global Constraints

- 所有 DB 物件 `journal_` 前綴；不碰 tradding_app 的表。
- 交易寫入一律用使用者 JWT；service role 只寫 `journal_push_subscriptions`／`journal_push_log`，只讀 `journal_trades` 計數，且限 `JOURNAL_OWNER_USER_ID`。
- BingX JSON 一律 `parseBingxJson`（positionId > 2^53）。
- 不用 `alert/confirm/prompt`；盈虧色 jade／ochre；時區 `src/lib/tz.ts`。
- 畫面元件不直接 import supabase-js，經 `src/lib/db.ts`。
- 檔案 UTF-8。

## 實作中發現、與規格的差異（實作前已確認）

1. **同步只匯入已平倉倉位**（`api/bingx/sync.ts` 的 `closeAllPositions` 過濾）。所以開倉卡按完成時，App **直接插一筆 `external_id = positionId` 的紀錄**（`source='bingx'`、`planned_stop=null`、`card_at=now`）；平倉後 sync 以 `byExternal` 找到它、走 `mergePatch` 更新（setup／理由／標籤／card_at 保留，`mergePatch` 不碰這些欄位）。不需要模糊對帳。
2. 持倉中的倉位不在 DB，收件匣要另外問 BingX：新增 `GET /api/bingx/open`（requireOwner）回目前持倉。
3. `/user/positions` 2026-11-13 實測時沒有持倉，欄位無法實測。解析寬鬆：開倉時間取 `createTime ?? openTime ?? updateTime ?? 偵測時間`；方向 `positionSide` LONG/SHORT，BOTH 看 `positionAmt` 正負。之後 sync 會用 `positionHistory` 的真值覆蓋 `opened_at`。**第一次有持倉時要補實測記錄。**
4. 收件匣只收最近 7 天（否則 10-12 起沒標的 60 多筆會一次灌進來）。更早的照舊在交易紀錄頁「待補」。
5. `last_tick_at` 不加到 `journal_settings`（service role 不碰別的表），改存 `journal_push_log` 的 `event_key='tick'`（每輪 upsert `sent_at`）。

## File Structure

| 檔案 | 職責 |
|---|---|
| `supabase/migrations/2026-11-13-push.sql` | 兩張表＋RLS |
| `src/notify/events.ts` | 純函數：BingX 持倉／歷史 → 推播事件、去重、文案、網址 |
| `src/lib/quickTag.ts` | 純函數：卡片輸入 → DB patch；待標記判斷 |
| `api/_lib/admin.ts` | service role client、cron 密鑰檢查 |
| `api/_lib/push.ts` | web-push 設定與送出（404/410 刪訂閱） |
| `api/notify/tick.ts` | cron 入口（GET/POST，`dryRun=1`） |
| `api/notify/test.ts` | 訂閱後送測試推播（使用者 JWT） |
| `api/bingx/open.ts` | 目前持倉（使用者 JWT） |
| `public/push-sw.js` | service worker 的 push／notificationclick |
| `src/lib/push.ts` | 前端訂閱／取消／狀態 |
| `src/lib/db.ts` | 加：`tagOpenPosition`、`tagTrade`、`savePushSubscription`、`deletePushSubscription`、`lastTickAt`、`fetchOpenPositions` |
| `src/components/QuickTagCard.tsx` | 共用卡片 |
| `src/pages/Tag.tsx` | `/tag/:kind/:pid` 推播落地頁 |
| `src/pages/Inbox.tsx` | `/inbox` 收件匣 |
| `src/pages/Home.tsx`、`Character.tsx`、`main.tsx`、`vite.config.ts`、`src/lib/trade.ts` | 入口、設定、路由、SW、`late_exit` |
| `tests/notify.test.ts`、`tests/quickTag.test.ts` | 純函數測試 |

---

### Task 1: 純函數（事件偵測＋卡片對應＋待標記）

**Files:** Create `src/notify/events.ts`, `src/lib/quickTag.ts`, `tests/notify.test.ts`, `tests/quickTag.test.ts`; Modify `src/lib/trade.ts`（`late_exit: '抱太久'`）

**Interfaces (Produces):**

```ts
// src/notify/events.ts
export interface BxOpenPosition { positionId: string; symbol: string; positionSide: string; positionAmt?: string; avgPrice: string; createTime?: number; openTime?: number; updateTime?: number }
export type PushEvent =
  | { kind: 'open'; key: string; positionId: string; symbol: string; direction: Direction; entry: number; openedAt: number }
  | { kind: 'close'; key: string; positionId: string; symbol: string; direction: Direction; closedAt: number; win: boolean }
  | { kind: 'daily'; key: string; count: number }
export const CLOSE_WINDOW_MS = 2 * 3600_000
export function openDirection(p: BxOpenPosition): Direction
export function openEvents(positions: BxOpenPosition[], sent: Set<string>, nowMs: number): PushEvent[]
export function closeEvents(history: BxPosition[], sent: Set<string>, nowMs: number): PushEvent[]
export function dailyEvent(pending: number, sent: Set<string>, nowMs: number): PushEvent | null // 台北 22 點那一小時、pending>0、沒推過 'daily:YYYY-MM-DD'
export function payloadOf(e: PushEvent): { title: string; body: string; url: string; tag: string }
// url: open → /tag/open/<pid>?s=SOLUSDT&d=long&p=<entry>&t=<openedAt>；close → /tag/close/<pid>；daily → /inbox
// src/lib/quickTag.ts
export interface OpenTagInput { setup_id: string | null; planned: boolean; reason: string }
export interface CloseTagInput { exit: 'plan' | 'early' | 'late'; chased: boolean; note: string }
export function openTagPatch(i: OpenTagInput, base: string[], nowIso: string, cardAt: string | null): { setup_id; entry_reason; mistake_tags; card_at }
export function closeTagPatch(t: RawTrade, c: CloseTagInput, o: OpenTagInput | null, nowIso: string): Partial<RawTrade>
export const INBOX_DAYS = 7
export function needsTag(t: RawTrade, nowMs: number): boolean
export function untaggedOpen(positions: BxOpenPosition[], trades: RawTrade[]): BxOpenPosition[]
```

規則：
- `openTagPatch`：`planned=false` → 標籤加 `unplanned`，`planned=true` → 移除 `unplanned`；`reason` trim 後空字串 → null；`card_at = cardAt ?? nowIso`。
- `closeTagPatch`：`early` → 加 `early_exit`、`late` → 加 `late_exit`、`plan` → 兩者都拿掉；`chased` → `chasing`（false 時拿掉）；`note` 空 → 不覆蓋既有 note；`reviewed_at = t.reviewed_at ?? nowIso`；`o` 不是 null（開倉沒標過）→ 併入 `openTagPatch`。
- `needsTag`：`gamified && source==='bingx' && opened_at && !abandoned_at` 且 [(`closed_at` 在 7 天內 且 (`reviewed_at===null` 或 `card_at===null`)) 或 (未平倉 且 `card_at===null`)]。
- `untaggedOpen`：持倉中、且 trades 裡沒有同 `external_id` 的。
- `closeEvents`：`closeAllPositions && updateTime >= now − 2h && !sent.has('close:'+id)`；`win = Number(netProfit) > 0`。
- `openEvents`：`!sent.has('open:'+id)`；不套 2 小時視窗（持倉本來就是「現在」）。

- [ ] Step 1：寫 `tests/notify.test.ts`、`tests/quickTag.test.ts`（每條規則至少一個案例，含 BOTH＋負 positionAmt → short、2h 邊界、台北 22 點判斷、`plan` 移除舊 `early_exit`、note 空字串不覆蓋）
- [ ] Step 2：`npm test` 確認失敗
- [ ] Step 3：實作兩檔＋`late_exit`
- [ ] Step 4：`npm test`、`npm run typecheck` 通過
- [ ] Step 5：commit `feat: 推播事件與快速標記的純函數`

### Task 2: Migration＋伺服器端（tick、test、open）

**Files:** Create `supabase/migrations/2026-11-13-push.sql`, `api/_lib/admin.ts`, `api/_lib/push.ts`, `api/notify/tick.ts`, `api/notify/test.ts`, `api/bingx/open.ts`; Modify `supabase/schema.sql`、`package.json`（`web-push`、`@types/web-push`）

Migration：

```sql
create table journal_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table journal_push_subscriptions enable row level security;
create policy journal_push_subs_own on journal_push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table journal_push_log (
  user_id uuid not null references auth.users on delete cascade,
  event_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, event_key)
);
alter table journal_push_log enable row level security;
create policy journal_push_log_read on journal_push_log for select using (user_id = auth.uid());
```

`tick.ts` 流程（`Authorization: Bearer ${NOTIFY_CRON_SECRET}`，GET/POST 都收）：
1. admin client；讀 owner 的 subscriptions（沒有 → 只寫 tick、回 `{ subs: 0 }`）與 push_log 最近 3 天的 key → `sent`。
2. `positions = bingxSigned('/openApi/swap/v2/user/positions', {})`。
3. 近 2 小時 income `TRADING_FEE` 的幣種 → 每個幣 `positionHistory`（`startTs = now − 7d`、`pageIndex 0`、`pageSize 100`）。
4. pending 計數：`journal_trades` owner、`source='bingx'`、`gamified`、`abandoned_at is null`、`closed_at >= now−7d`、(`reviewed_at is null` or `card_at is null`)，加上 `untaggedOpen` 的筆數（open 的對照用 owner 的 external_id 清單）。
5. 事件 = open＋close＋daily；`dryRun=1` → 回傳事件不送。
6. 每個事件送給每個訂閱；任一成功 → `upsert push_log (on conflict do nothing)`；404/410 → 刪訂閱。
7. 最後 upsert `event_key='tick'`（`sent_at=now`，用 `onConflict` 更新）。BingX 失敗 → 502，但仍寫 tick（區分「cron 停」與「BingX 掛」不是這版要做的；記在 log）。

`test.ts`：requireOwner → 用使用者 JWT 讀自己的 subscriptions → 送「推播已開啟」。
`open.ts`：requireOwner → 回 `positions`。

- [ ] Step 1：裝依賴 `npm i web-push && npm i -D @types/web-push`
- [ ] Step 2：寫 migration、同步 `schema.sql`
- [ ] Step 3：寫 `admin.ts`、`push.ts`、三個端點
- [ ] Step 4：`npm run typecheck`、`npm test`
- [ ] Step 5：commit `feat: 推播 tick／測試推播／目前持倉端點與 migration`

### Task 3: 前端（SW、訂閱、卡片、落地頁、收件匣、入口）

**Files:** Create `public/push-sw.js`, `src/lib/push.ts`, `src/components/QuickTagCard.tsx`, `src/pages/Tag.tsx`, `src/pages/Inbox.tsx`; Modify `vite.config.ts`（`workbox.importScripts: ['push-sw.js']`）、`src/lib/db.ts`、`src/main.tsx`、`src/pages/Home.tsx`、`src/pages/Character.tsx`

- `push-sw.js`：`push` → `showNotification(title, { body, tag, data: { url } })`；`notificationclick` → 找已開視窗 `navigate(url)`＋`focus`，否則 `openWindow(url)`。
- `src/lib/push.ts`：`pushSupported()`、`isStandalone()`、`pushStatus()`（'unsupported'|'need-install'|'off'|'on'）、`enablePush()`（requestPermission → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `db.savePushSubscription` → `/api/notify/test`）、`disablePush()`。
- `QuickTagCard`：props `{ mode: 'open' | 'close'; trade: RawTrade（open 時是合成的）; setups; needOpenRows: boolean; onDone(open: OpenTagInput | null, close: CloseTagInput | null) }`。Setup 無預設必點（沒點時完成鈕 disabled）；其他列預設照計畫／沒有；一句話單行 input。上方 `TradeChart`。
- `Tag.tsx`：`open` → 參數組成合成 RawTrade；已有同 external_id 的紀錄就改走 `tagTrade`。`close` → 等 `useSync` 版本（`syncNow()` 後 version 變）找 external_id；找不到 → 顯示「還沒同步到」＋連到 `/inbox`。完成後回 `/inbox`（有剩）或首頁。
- `Inbox.tsx`：`needsTag` 的交易＋`fetchOpenPositions` 的 `untaggedOpen`，一張一張；完成後下一張；空的時候顯示「都標完了」。
- 首頁頂部：收件匣數 > 0 顯示「待標記 N 筆 →」連 `/inbox`（放在既有「待補」上方）；`lastTickAt` 超過 1 小時且已開推播 → 灰字「推播排程超過 1 小時沒跑」。
- 設定：「推播」一列：狀態文字＋開啟／關閉按鈕；`need-install` 顯示「iOS 要先從 Safari 分享 → 加入主畫面，再從主畫面開」。
- 預先建 setup「突破／追勢」「支撐壓力反轉」：用 `sb-query`／MCP 直接 insert（owner user_id），不寫程式。

- [ ] Step 1：SW＋vite 設定
- [ ] Step 2：db.ts 函數＋push.ts
- [ ] Step 3：QuickTagCard、Tag、Inbox、路由
- [ ] Step 4：首頁入口、設定頁
- [ ] Step 5：`npm run typecheck`、`npm test`、`npx oxlint`、`npm run build`（確認 `dist/sw.js` 含 `importScripts("push-sw.js")`）
- [ ] Step 6：commit `feat: 推播快速標記卡、收件匣與設定頁推播開關`

### Task 4: 部署與設定

- [ ] 跑 migration（MCP `apply_migration`）；建兩個 setup
- [ ] 產生 VAPID（`npx web-push generate-vapid-keys`）、`NOTIFY_CRON_SECRET`（隨機 32 bytes hex）；`npx vercel env add` 設 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`VITE_VAPID_PUBLIC_KEY`、`NOTIFY_CRON_SECRET`（production）
- [ ] 使用者：Vercel 加 `SUPABASE_SERVICE_ROLE_KEY`；外部 cron 每 5 分鐘 `GET https://tradding-dialog-app.vercel.app/api/notify/tick` 帶 header `Authorization: Bearer <secret>`
- [ ] push＋`npx vercel deploy --prod --yes`；確認登入頁版本號
- [ ] `curl` tick `?dryRun=1` 回 200 與事件清單
- [ ] 更新 CLAUDE.md（權限規則改寫、推播、tick、持倉欄位待實測）
- [ ] 使用者 iPhone 實測（規格「測試」段）

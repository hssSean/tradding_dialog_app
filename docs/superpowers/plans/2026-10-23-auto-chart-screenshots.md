# K 線自動截圖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同步完成後，把缺圖交易的 K 線圖畫成 JPEG，存進進場／出場截圖格。

**Architecture:** 純函數 `src/lib/chartShots.ts` 決定補哪些圖、K 線範圍、標題；`src/components/chartDraw.ts` 是詳情頁 K 線卡與截圖共用的畫圖程式；`src/lib/autoShots.ts` 串起抓 K 線、畫圖、上傳，由 `sync.tsx` 在同步後呼叫。

**Tech Stack:** React 19、lightweight-charts 5（`takeScreenshot()`）、Supabase Storage、vitest。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-10-23-auto-chart-screenshots-design.md`
- 只輸出 JPEG 品質 0.8，最長邊 ≤ 2000px（`image.ts` 的 `JPEG_QUALITY`、`fitSize`）
- 絕不覆蓋已存在的截圖；自動圖檔名 `{kind}-auto-{時間}.jpg`
- 顏色沿用 `TradeChart.tsx` 寫死的十六進位值；盈虧不用紅綠
- 畫面元件不直接 import `supabase-js`
- 不改資料表、不改 `src/game`

---

### Task 1：純函數 `chartShots.ts`

**Files:** Create `src/lib/chartShots.ts`、`tests/chartShots.test.ts`

**Produces:**
- `type Interval = '5m' | '15m' | '1h'`、`INTERVAL_MS`、`BEFORE_BARS = 60`、`AFTER_BARS = 30`
- `defaultInterval(holdMs: number): Interval`（從 `TradeChart.tsx` 搬來）
- `chartRange(trade: RawTrade, mode: 'entry' | 'full', interval: Interval, now: number): { start: number; end: number }`：`entry` 結束在進場那根的開盤時間；`full` 結束在 `min(now, 出場 + 30 根)`，未平倉以 `now` 當出場
- `missingShots(trades: RawTrade[], images: { trade_id: string; kind: ImageKind }[]): { trade: Trade; kind: ImageKind }[]`
- `shotTitle(trade: RawTrade, kind: ImageKind, interval: Interval): string`，例 `ICPUSDT 做多 · 進場 · 15 分 · 10/12 21:30`

- [ ] 寫測試（缺圖判斷五種情況、範圍、標題）→ 跑 `npx vitest run tests/chartShots.test.ts` 確認失敗
- [ ] 實作 → 測試通過

### Task 2：共用畫圖 `chartDraw.ts`，`TradeChart` 改用它

**Files:** Create `src/components/chartDraw.ts`；Modify `src/components/TradeChart.tsx`

**Produces:**
- `createTradeChart(el: HTMLElement, trade: RawTrade, size?: { width: number; height: number })`：回傳 `{ chart, series }`，沒給 size 就 `autoSize`
- `drawTrade(chart, series, trade, candles: Candle[], interval: Interval, mode: 'entry' | 'full')`：價格線與標記；`entry` 只畫進場、初始止損、目標與「進」
- `renderShot(trade: Trade, kind: ImageKind, interval: Interval, candles: Candle[]): Promise<Blob>`：畫面外 1000×640 圖表 → `takeScreenshot()` → 加標題列 → `fitSize` 縮放 → JPEG

- [ ] 抽出程式，`TradeChart` 只保留狀態、抓資料與版面，範圍改用 `chartRange(..., 'full', ...)`
- [ ] `npm run typecheck` 通過

### Task 3：產生與上傳 `autoShots.ts`、接上同步

**Files:** Create `src/lib/autoShots.ts`；Modify `src/lib/db.ts`（`uploadImage` 加 `opts?: { auto?: boolean }`，auto 時那格已有圖就不寫）、`src/lib/sync.tsx`

**Produces:** `generateMissingShots(): Promise<number>`：回傳新增張數；同時只跑一個；動態 `import('../components/chartDraw')`；單筆失敗 `console.warn` 後跳過；K 線為空跳過

- [ ] 實作；`sync.tsx` 同步成功後呼叫，產生 > 0 張時 `version + 1`
- [ ] `npm run typecheck` 通過

### Task 4：詳情頁顯示「自動產生」與取代

**Files:** Modify `src/pages/TradeDetail.tsx`（`ImagesCard`、`ImageSlot`）

- [ ] `ImagesCard` 的 `useAsync` deps 加 `useSync().version`
- [ ] 圖片路徑含 `-auto-` 時標題旁顯示「自動產生」，下方放 `ImagePicker`「換成自己的截圖」＋上傳按鈕
- [ ] typecheck → `npm test` → `npm run build` → `npx oxlint`

### Task 5：驗證、commit、部署

- [ ] 本機 `npm run dev` 用瀏覽器登入，確認背景補圖、詳情頁圖片正確（進場圖沒有進場後 K 線）
- [ ] code-self-review
- [ ] commit、push、`npx vercel deploy --prod --yes`，確認線上版本號

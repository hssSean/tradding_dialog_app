# CLAUDE.md — 專案指引

## 語言規定
**所有回覆一律使用繁體中文。**
程式碼、指令、API 名稱、錯誤訊息原文保持原樣。

---

## 編碼規定
**所有檔案皆使用 UTF-8 編碼，Claude 讀寫檔案時也一律使用 UTF-8。**
檔案寫入（如紀錄檔、逐字稿、快取 JSON）必須明確指定 `encoding='utf-8'`，避免 Windows 預設編碼（CP950）導致閃退或亂碼。

---

## 專案概觀

手動交易紀錄 PWA（交易日誌）：使用者在 iPhone 上記錄自己的**手動**交易，每週檢討「問題出在哪」（紀律、setup、時段／幣種／方向）。
v2（2026-10-04）加上夜墨山水首頁與遊戲化：作戰卡、評分評級、精神力、狀態異常、倉位階級、屬性、心魔、功課、圖鑑、成就、賽季。規格是 `trade-journal-handoff/SPEC.md`，決定與偏離記在 `docs/superpowers/plans/2026-10-04-v2-gamification.md`。

- **技術棧**：Vite + React 19 + TypeScript + Tailwind 4 + `vite-plugin-pwa`，純前端，部署 Vercel
- **資料**：Supabase（Postgres + Auth email/密碼 + Storage 私有 bucket `journal-screenshots`），全部靠 RLS 保護，沒有自己的後端
- **🔴 與 `tradding_app` 共用同一個 Supabase 專案與帳號**：本專案所有 DB 物件（表、函數、trigger、policy、bucket）一律 `journal_` 前綴。**絕不可**建立、修改、刪除 tradding_app 的 `trades`、`profiles`、`watchlist`、`push_subscriptions`，也不要用 `create or replace` 蓋到沒有前綴的函數。不可關閉公開註冊（tradding_app 需要）。
- **資料來源**：全部手動輸入，不接交易所 API
- **設計規格**：`docs/superpowers/specs/2026-10-04-trade-journal-design.md`（改行為前先讀）
- **部署步驟**：`README.md`

### ⚠️ 容易踩的坑

- **時區固定台北**（`src/lib/tz.ts`），不依賴裝置時區。週次以 `closed_at` 歸週、週一 00:00 起算。
- **紀律規則只有一份，在 `src/game`**。v1 的 `autoFlags`／30 分鐘報復單已移除，不要在別處重寫違規判斷。
- **交易生命週期**：`opened_at IS NULL` 是作戰卡，`abandoned_at` 是放棄的卡，`gamified = false` 是 v2 之前的舊資料（不評分、不算違規，但照樣影響精神力與冷卻）。
- **風險 % 不要先四捨五入再比門檻**：0.625% 會被進位成 0.63% 而跨過 1.25 倍上限（2026-10-04 測試抓到）。
- **不用 `alert()`／`confirm()`／`prompt()`**（SPEC §8），二次確認一律做成頁面內區塊。
- **盈虧不用紅綠**：賺 `jade`、賠 `ochre`，token 在 `src/index.css`；首頁 canvas 的顏色是寫死的十六進位值，改 token 要一起改 `Scene.tsx`。
- **截圖只能輸出 JPEG**：iOS Safari canvas 不支援 WebP，會悄悄變 PNG。
- **不要用 magic link 登入**：iPhone 主畫面 PWA 與 Safari 儲存空間分開。
- **畫面元件不直接 import `supabase-js`**，一律經 `src/lib/db.ts`。
- 新增資料表或欄位：同步改 `supabase/schema.sql`，並提醒使用者到 Supabase SQL Editor 執行 `ALTER TABLE`。

### 相關專案

| 路徑 | 內容 |
|---|---|
| `C:\tradding_app` | 加密貨幣永續合約訊號推薦系統（Next.js PWA + Supabase + Upstash，live-runner 在 testnet 真下單） |
| `C:\trading_stratage` | Python 策略研究／回測（Keltner、ICT、SNR、YouTube 策略轉錄與驗收） |

**跨專案引用規則前，先讀對方的 `CLAUDE.md` 與 `docs/ANALYSIS-*`**——很多「看起來該改」的東西在 `tradding_app` 已驗證無效。

## 常用指令

```bash
npm run dev          # 本機開發（需 .env.local，見 .env.example）
npm test             # vitest（純函數）
npm run typecheck    # tsc -b
npm run build        # production build（含 PWA service worker）
npx oxlint           # lint
node scripts/sb-query.mjs -e "select ..."   # 對 Supabase 執行 SQL（需 .env.local 的 SUPABASE_ACCESS_TOKEN）
node scripts/sb-query.mjs migration.sql     # 執行 SQL 檔
```

部署：push 到 `main` 由 Vercel（專案 `tradding-dialog-app`，https://tradding-dialog-app.vercel.app）自動部署。
資料庫：`supabase/schema.sql` 已於 2026-10-05 套用。之後改 schema 要另寫 migration 並用 `sb-query.mjs` 執行，同時更新 `schema.sql`。

## 關鍵檔案

| 檔案 | 職責 |
|---|---|
| `src/game/rules.ts` | 遊戲化所有數值與文字（SPEC §4），改數值只改這裡 |
| `src/game/evaluate.ts` | 依時間重播每筆交易：違規、開倉當下精神力與階級、評分評級（純函數） |
| `src/game/progress.ts` | 狀態異常、屬性、職業、功課、連續天數、心魔、成就、圖鑑、賽季、經驗值（純函數） |
| `src/game/engine.ts` | `computeGameState`：UI 只讀這裡的輸出 |
| `src/lib/trade.ts` | 單筆：R、風險 %、目前止損、逆向移動判斷、輸入驗證（純函數） |
| `src/lib/stats.ts` | 每週檢討：週次、分組、本週最大問題歸因（紀律鍵由引擎傳入） |
| `src/lib/forms.ts` | 字串表單 ↔ 資料型別轉換與驗證 |
| `src/lib/db.ts` | 唯一的 Supabase 存取點 |
| `src/lib/image.ts` | 截圖壓縮（最長邊 2000px、JPEG 0.8） |
| `supabase/schema.sql` | 資料表、RLS、Storage policy |
| `src/pages/WeeklyReview.tsx` | 每週檢討頁 |

## 專案慣例

- **損益一律用 R 倍數**（損益% ÷ 止損距離%）與帳戶實際損益衡量，不用原始價格 %。
- **訊號只吃已收盤 K 棒**。吃形成中 K 棒會讓同一根 K 棒在不同時點給出不同答案。
- **宣稱統計結論前先看樣本量、顯著性、涵蓋率**。量測錯誤在被抓到前都長得像結論。
- **規則只有一份**：回測與線上共用同一份邏輯，不要在腳本裡複製。
- 改完程式：型別檢查 → 測試 → build → commit（訊息附 Co-Authored-By）→ push。

## 工具規定

### 🔴 強制觸發（不是建議，是規定）

| 情境 | 必用 | 為什麼 |
|---|---|---|
| 任何 bug／非預期行為 | `superpowers:systematic-debugging` | 先量測再修，不要憑猜測連改好幾輪 |
| 要說「修好了」之前 | `superpowers:verification-before-completion`，實跑檢查 | 第一版修正常引入更糟的 bug，靠測試擋 |
| 要新增功能／重構／「要不要重做」 | `superpowers:brainstorming` | 先發散再收斂，不要直接跳到實作或數據分析 |
| 改完任何程式碼、回報完成前 | `anthropic-skills:code-self-review` | 自我審查邏輯與架構 |
| 要理解跨檔呼叫關係 | `/graphify .` 或 `claude-mem:smart-explore` | 大檔整檔讀既慢又容易漏 |
| 查「這個之前做過嗎」 | `claude-mem:mem-search` | 避免重跑已經做過的分析 |
| 抓外部網頁／API 文件 | `WebFetch`／`WebSearch` | firecrawl 無 key，不要用 |

### ⚠ 外掛設定備忘

- **RTK**：hook 指令必須是裸 `rtk hook claude`，寫絕對路徑會讓 rtk 自我偵測失敗、每次 Bash 輸出都多一行警告。**不要跑 `rtk init -g --auto-patch`**（可能重複追加 hook）。
- **「工具沒生效」要拿用量統計證實**（`rtk gain`），不要只信它的自我檢查。
- **caveman statusline** 路徑含版本雜湊，外掛更新後狀態列變空白時去 `~/.claude/plugins/cache/caveman/caveman/` 找新雜湊。

---

## 已安裝的外掛與指令總覽

> 三個外掛：**superpowers**（流程紀律）、**claude-mem**（跨 session 記憶）、**caveman**（回覆壓縮）。
> 完整說明見 `C:\tradding_app\CLAUDE.md` 同名章節。

### superpowers — 流程紀律

| Skill | 什麼時候用 |
|---|---|
| `superpowers:brainstorming` | 要做新功能／新元件前。**先腦力激盪再進 plan mode** |
| `superpowers:systematic-debugging` | 遇到任何 bug／測試失敗／非預期行為，**在提出修法之前** |
| `superpowers:test-driven-development` | 實作功能或修 bug，寫實作碼之前 |
| `superpowers:verification-before-completion` | 要宣稱「做完了／修好了」之前，強制實跑驗證 |

其餘：`writing-plans`、`executing-plans`、`subagent-driven-development`、`dispatching-parallel-agents`、`requesting-code-review` / `receiving-code-review`、`using-git-worktrees`、`finishing-a-development-branch`、`writing-skills`。

### claude-mem — 跨 session 記憶 + 程式碼探索

| Skill | 用途 |
|---|---|
| `claude-mem:mem-search` | 查跨 session 記憶：「這個之前做過嗎？」 |
| `claude-mem:smart-explore` | tree-sitter AST 結構搜尋，**取代整檔讀取**，省 token |
| `claude-mem:learn-codebase` | 一次讀完整個 repo 建立記憶（選用） |
| `claude-mem:make-plan` / `claude-mem:do` | 分階段計畫／用子代理執行 |
| `claude-mem:what-the` | 把技術細節翻成白話 |
| `claude-mem:handoff` | 產生 HANDOFF.md 給下個 session 接手 |

### caveman — 回覆壓縮（預設啟用）

```
/caveman lite|full|ultra   # 切換壓縮強度（預設 full）
/caveman-commit            # 產生精簡 commit message
/caveman-review            # 一行式 code review
/caveman-stats             # token 用量與節省統計
```

關閉：說「stop caveman」或「normal mode」。
**注意**：commit message／PR／安全警告一律寫正常中文，不套壓縮風格。

子代理：`caveman:cavecrew-investigator`（唯讀定位）、`caveman:cavecrew-builder`（1-2 檔編輯）、`caveman:cavecrew-reviewer`（diff 審查）。

### 其他常用

- `/code-review`（含 `ultra` 多代理雲端審查，使用者觸發、計費，Claude 不能自己叫）
- `/run`、`/simplify`、`/security-review`
- **RTK**（`~/.claude/RTK.md`）：hook 自動改寫指令；`rtk gain` 看節省統計。
- **MCP**：`binance-futures`（K 線、資金費率、OI、多空比、訂單簿）、`crypto`（價格、成交量、OHLCV）。

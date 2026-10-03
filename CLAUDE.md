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

> TODO：專案剛建立，尚無程式碼。確定技術棧與目的後補上。

- **目的**：（待補）
- **技術棧**：（待補）
- **資料來源**：（待補；可用 MCP：`binance-futures`、`crypto`）

### 相關專案

| 路徑 | 內容 |
|---|---|
| `C:\tradding_app` | 加密貨幣永續合約訊號推薦系統（Next.js PWA + Supabase + Upstash，live-runner 在 testnet 真下單） |
| `C:\trading_stratage` | Python 策略研究／回測（Keltner、ICT、SNR、YouTube 策略轉錄與驗收） |

**跨專案引用規則前，先讀對方的 `CLAUDE.md` 與 `docs/ANALYSIS-*`**——很多「看起來該改」的東西在 `tradding_app` 已驗證無效。

## 常用指令

```bash
# TODO：建立專案後補上（開發、型別檢查、測試、build）
```

## 關鍵檔案

> TODO

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

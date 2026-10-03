# 交易日誌

記錄手動交易、每週檢討問題出在哪的 PWA，可在 iPhone 加入主畫面使用。設計見 `docs/superpowers/specs/2026-10-04-trade-journal-design.md`。

## 第一次部署

### 1. Supabase（共用 tradding_app 的專案）

與 `tradding_app` 共用同一個 Supabase 專案與登入帳號。本專案的資料表、函數、bucket、policy 一律有 `journal_` 前綴，不會動到 tradding_app 的 `trades`、`profiles` 等表。

1. 打開 tradding_app 的 Supabase 專案 → 左側 **SQL Editor** → New query → 貼上 `supabase/schema.sql` 整份 → Run。
2. 用 tradding_app 的 email 與密碼登入即可，不用另建帳號。
3. **不要**關閉公開註冊：tradding_app 有註冊功能，關掉會影響它。別人就算註冊了，RLS 也只讓他看到自己的資料。
4. URL 與 anon key 跟 tradding_app 的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 相同（Vercel 上 tradding_app 的環境變數，或 Supabase **Project Settings → API**）。

### 2. Vercel

1. <https://vercel.com/new> → 匯入 GitHub repo `hssSean/tradding_dialog_app`。
2. Framework 會自動偵測為 Vite。
3. Environment Variables 加兩個：
   - `VITE_SUPABASE_URL` = tradding_app 的 `NEXT_PUBLIC_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` = tradding_app 的 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy。之後 push 到 `main` 就會自動重新部署。

anon key 本來就是公開給瀏覽器用的，資料安全靠 RLS（每張表只能存取自己的列）。

### 3. iPhone

用 **Safari** 打開 Vercel 給的網址 → 分享 → **加入主畫面**。之後從主畫面圖示開啟，登入一次就會保持登入。

## 本機開發

```bash
cp .env.example .env.local   # 填入 Supabase URL 與 anon key
npm install
npm run dev                  # http://localhost:5173
npm test                     # vitest
npm run typecheck            # tsc
npm run build                # production build
```

# 交易日誌

記錄手動交易、每週檢討問題出在哪的 PWA，可在 iPhone 加入主畫面使用。設計見 `docs/superpowers/specs/2026-10-04-trade-journal-design.md`。

## 第一次部署

### 1. Supabase

1. 到 <https://supabase.com> 建立**新專案**（區域選 Singapore 或 Tokyo）。
2. 左側 **SQL Editor** → New query → 貼上 `supabase/schema.sql` 整份 → Run。
3. **Authentication → Users → Add user → Create new user**：填自己的 email 與密碼，勾選 Auto Confirm User。
4. **Authentication → Sign In / Providers**：關閉 **Allow new users to sign up**（避免別人註冊）。
5. **Project Settings → API**：記下 `Project URL` 與 `anon public` key。

### 2. Vercel

1. <https://vercel.com/new> → 匯入 GitHub repo `hssSean/tradding_dialog_app`。
2. Framework 會自動偵測為 Vite。
3. Environment Variables 加兩個：
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
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

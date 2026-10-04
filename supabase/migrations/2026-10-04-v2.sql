-- 交易日誌 v2：作戰卡、移動止損、復盤、截圖標註、每日筆記（SPEC §6）
-- 與 tradding_app 共用資料庫：只動 journal_ 開頭的物件。整份在一個 transaction 內執行。

-- 交易：作戰卡＝opened_at 為 null 的交易
alter table journal_trades alter column opened_at drop not null;
alter table journal_trades
  add column card_at timestamptz,                         -- 作戰卡存檔時間；早於 opened_at 才算「進場前」
  add column emotion smallint check (emotion between 1 and 5),
  add column equity_at_entry numeric check (equity_at_entry > 0),
  add column stop_edits jsonb not null default '[]',      -- [{at, from, to}]
  add column reviewed_at timestamptz,                     -- 第一次寫復盤（note）的時間
  add column abandoned_at timestamptz,                    -- 作戰卡放棄、沒有進場
  add column gamified boolean not null default true;      -- false = v2 之前的舊資料，評分顯示「資料不足」

-- v2 之前的交易：欄位不齊，不評分、不算違規
update journal_trades set gamified = false;

-- 平倉的交易一定要有進場時間
alter table journal_trades add constraint journal_trades_closed_needs_open check (closed_at is null or opened_at is not null);

-- 截圖標註：有文字才算「標註」
alter table journal_trade_images
  add column caption text,
  add column captioned_at timestamptz;

-- 設定：起始權益（之後自動加上每筆損益）、顯示中的稱號
alter table journal_settings
  add column starting_equity numeric check (starting_equity > 0),
  add column display_title text;

-- 圖鑑卡的每月檢查（保留或淘汰）
alter table journal_setups add column reviewed_at timestamptz;

-- 每日筆記：市場觀察、本週最大的錯誤
create table journal_daily_notes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,                                     -- 台北日期
  market_view text,
  weekly_mistake text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
create trigger journal_daily_notes_updated before update on journal_daily_notes
  for each row execute function journal_set_updated_at();
alter table journal_daily_notes enable row level security;
create policy journal_own on journal_daily_notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

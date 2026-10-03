-- 交易日誌 schema。在 Supabase 後台 SQL Editor 整份貼上執行一次。
-- 與 tradding_app 共用同一個 Supabase 專案：所有物件一律加 journal_ 前綴，
-- 不可以碰 tradding_app 的 trades、profiles、watchlist、push_subscriptions。

-- ── 共用：updated_at 自動更新 ───────────────────────────
create or replace function journal_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── 資料表 ──────────────────────────────────────────────
create table journal_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  standard_risk_usdt numeric not null default 10 check (standard_risk_usdt > 0),
  updated_at timestamptz not null default now()
);

create table journal_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table journal_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- 進場（計畫）
  symbol text not null,
  direction text not null check (direction in ('long', 'short')),
  setup_id uuid references journal_setups on delete set null,
  timeframe text,
  opened_at timestamptz not null,
  entry_price numeric not null check (entry_price > 0),
  planned_stop numeric not null check (planned_stop > 0),
  planned_target numeric check (planned_target > 0),
  risk_usdt numeric not null check (risk_usdt > 0),
  entry_reason text,
  -- 出場（結果），未平倉時為 null
  closed_at timestamptz,
  exit_price numeric check (exit_price > 0),
  final_stop numeric check (final_stop > 0),
  exit_reason text check (exit_reason in ('target', 'stop', 'manual_plan', 'manual_early', 'other')),
  pnl_usdt numeric,
  mistake_tags text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((closed_at is null) = (exit_price is null)),
  check (closed_at is null or exit_reason is not null)
);
create index journal_trades_user_closed on journal_trades (user_id, closed_at desc);
create index journal_trades_user_opened on journal_trades (user_id, opened_at desc);

create table journal_trade_images (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references journal_trades on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('entry', 'exit')),
  path text not null,
  size_bytes int not null,
  created_at timestamptz not null default now(),
  unique (trade_id, kind)
);

create table journal_weekly_reviews (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  week_start date not null,
  note text,
  next_week_focus text,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create trigger journal_settings_updated before update on journal_settings for each row execute function journal_set_updated_at();
create trigger journal_trades_updated before update on journal_trades for each row execute function journal_set_updated_at();
create trigger journal_weekly_reviews_updated before update on journal_weekly_reviews for each row execute function journal_set_updated_at();

-- ── RLS：只能存取自己的資料 ─────────────────────────────
alter table journal_settings enable row level security;
alter table journal_setups enable row level security;
alter table journal_trades enable row level security;
alter table journal_trade_images enable row level security;
alter table journal_weekly_reviews enable row level security;

create policy journal_own on journal_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy journal_own on journal_setups for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy journal_own on journal_trades for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy journal_own on journal_trade_images for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy journal_own on journal_weekly_reviews for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Storage：私有 bucket，路徑第一段必須是自己的 user id ──
insert into storage.buckets (id, name, public) values ('journal-screenshots', 'journal-screenshots', false);

create policy journal_screenshots_select on storage.objects for select
  using (bucket_id = 'journal-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy journal_screenshots_insert on storage.objects for insert
  with check (bucket_id = 'journal-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy journal_screenshots_update on storage.objects for update
  using (bucket_id = 'journal-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy journal_screenshots_delete on storage.objects for delete
  using (bucket_id = 'journal-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

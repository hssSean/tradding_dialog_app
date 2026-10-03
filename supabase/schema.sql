-- 交易日誌 schema。在 Supabase 後台 SQL Editor 整份貼上執行一次。

-- ── 共用：updated_at 自動更新 ───────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── 資料表 ──────────────────────────────────────────────
create table settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  standard_risk_usdt numeric not null default 10 check (standard_risk_usdt > 0),
  updated_at timestamptz not null default now()
);

create table setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- 進場（計畫）
  symbol text not null,
  direction text not null check (direction in ('long', 'short')),
  setup_id uuid references setups on delete set null,
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
create index trades_user_closed on trades (user_id, closed_at desc);
create index trades_user_opened on trades (user_id, opened_at desc);

create table trade_images (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('entry', 'exit')),
  path text not null,
  size_bytes int not null,
  created_at timestamptz not null default now(),
  unique (trade_id, kind)
);

create table weekly_reviews (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  week_start date not null,
  note text,
  next_week_focus text,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create trigger settings_updated before update on settings for each row execute function set_updated_at();
create trigger trades_updated before update on trades for each row execute function set_updated_at();
create trigger weekly_reviews_updated before update on weekly_reviews for each row execute function set_updated_at();

-- ── RLS：只能存取自己的資料 ─────────────────────────────
alter table settings enable row level security;
alter table setups enable row level security;
alter table trades enable row level security;
alter table trade_images enable row level security;
alter table weekly_reviews enable row level security;

create policy own on settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on setups for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on trades for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on trade_images for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on weekly_reviews for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Storage：私有 bucket，路徑第一段必須是自己的 user id ──
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false);

create policy screenshots_select on storage.objects for select
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy screenshots_insert on storage.objects for insert
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy screenshots_update on storage.objects for update
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy screenshots_delete on storage.objects for delete
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

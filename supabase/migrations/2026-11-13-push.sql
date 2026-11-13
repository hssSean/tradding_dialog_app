-- 2026-11-13 推播快速標記（docs/superpowers/specs/2026-11-13-push-quick-tag-design.md）
-- 訂閱由 App 用使用者 JWT 寫入；推播紀錄只有 /api/notify/tick 用 service role 寫入（限 JOURNAL_OWNER_USER_ID）。
create table journal_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table journal_push_subscriptions enable row level security;
create policy journal_own on journal_push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- event_key：'open:<positionId>' | 'close:<positionId>' | 'daily:<台北日期>' | 'tick'（最後一次排程執行時間）
create table journal_push_log (
  user_id uuid not null references auth.users on delete cascade,
  event_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, event_key)
);
alter table journal_push_log enable row level security;
create policy journal_read_own on journal_push_log for select using (user_id = auth.uid());

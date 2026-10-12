-- 2026-10-12：BingX 自動匯入
-- 只動 journal_ 開頭的物件
alter table journal_trades
  add column source text not null default 'manual' check (source in ('manual', 'bingx')),
  add column external_id text,                -- BingX positionId
  alter column planned_stop drop not null;    -- 匯入時沒有止損單 → 待補止損
create unique index journal_trades_external on journal_trades (user_id, external_id) where external_id is not null;
alter table journal_settings add column bingx_synced_at timestamptz;

-- 2026-10-11：拿掉倉位與金錢計算，風險金額不再必填（舊資料保留原值）
-- 只動 journal_ 開頭的物件
alter table journal_trades alter column risk_usdt drop not null;

-- 008: structured fields extracted from receipts, business cards, whiteboards, invoices.
alter table oneclist_items
  add column if not exists doc_type       text check (doc_type in ('receipt','invoice','business_card','whiteboard','document','other')),
  add column if not exists doc_vendor     text,
  add column if not exists doc_date       date,
  add column if not exists doc_total      numeric(14,2) check (doc_total is null or doc_total >= 0),
  add column if not exists doc_currency   char(3),
  add column if not exists doc_data       jsonb,        -- full validated extraction (line items, contact, takeaways, warnings)
  add column if not exists doc_confidence real check (doc_confidence is null or doc_confidence between 0 and 1),
  add column if not exists doc_scanned_at timestamptz;

create index if not exists items_doc_idx on oneclist_items (user_id, doc_type, doc_date desc) where doc_type is not null;
create index if not exists items_doc_vendor_idx on oneclist_items (user_id, lower(doc_vendor)) where doc_vendor is not null;
create index if not exists items_doc_data_gin on oneclist_items using gin (doc_data jsonb_path_ops);

-- Spend per vendor/currency for a date range (receipts + invoices). Mixed currencies are never summed together.
create or replace function spend_summary(p_user uuid, p_from date, p_to date)
returns table (vendor text, currency char(3), documents bigint, total numeric)
language sql stable security invoker set search_path = public as $$
  select coalesce(doc_vendor, 'Unknown'), doc_currency, count(*), sum(doc_total)
  from oneclist_items
  where user_id = p_user and doc_type in ('receipt','invoice') and doc_total is not null and doc_currency is not null
    and doc_date between p_from and p_to
  group by 1, 2 order by 4 desc;
$$;

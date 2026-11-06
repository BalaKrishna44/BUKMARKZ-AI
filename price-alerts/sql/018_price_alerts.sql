-- 018: Price-drop alerts. Run after 001 (oneclist_items). Independent of 013/016/017.
--
-- Privacy by design: a user's browser only reports prices for products THEY are watching (the server rejects anything else), so this is not
-- browsing-history collection. Prices are crowd-sourced, so they are treated as untrusted: see price_claim_alerts for how a single (possibly fake)
-- report is prevented from alerting other people.

create table if not exists product_watches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  item_id        uuid not null references oneclist_items(id) on delete cascade,
  product_key    text not null check (char_length(product_key) between 3 and 200),        -- "amazon.in:B0ABC12345": derived on the server from the item's URL, never client-supplied
  target_price   numeric(12,2) not null check (target_price > 0 and target_price <= 100000000),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  min_drop_pct   numeric(5,2) not null default 5 check (min_drop_pct between 0 and 90),   -- extra guard: also at least this far below the 90-day median (ignored while there is no history)
  active         boolean not null default true,
  last_alert_at  timestamptz,
  last_price     numeric(12,2),                                                           -- last price the user's own browser reported
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, item_id)
);
create index if not exists product_watches_key_idx on product_watches (product_key) where active;

create table if not exists price_observations (
  id          bigint generated always as identity primary key,
  product_key text not null check (char_length(product_key) between 3 and 200),
  price       numeric(12,2) not null check (price > 0 and price <= 100000000),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  source      text not null default 'extension' check (source in ('extension','crawler','manual')),
  observer_id uuid references auth.users(id) on delete set null,
  observed_at timestamptz not null default now()
);
create index if not exists price_obs_key_idx on price_observations (product_key, currency, observed_at desc);
create index if not exists price_obs_observer_idx on price_observations (observer_id, observed_at desc);

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh     text not null check (char_length(p256dh) between 20 and 200),
  auth       text not null check (char_length(auth) between 10 and 100),
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

create table if not exists price_alert_log (                                              -- audit trail: what was sent, why, and whether it worked
  id         bigint generated always as identity primary key,
  watch_id   uuid references product_watches(id) on delete set null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  price      numeric(12,2) not null, currency text not null,
  channels   text[] not null default '{}', status text not null check (status in ('sent','failed')),
  created_at timestamptz not null default now()
);
create index if not exists price_alert_log_user_idx on price_alert_log (user_id, created_at desc);

-- Guard: a watch must point at the user's own item, and a user cannot hoard watches.
create or replace function product_watches_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from oneclist_items where id = new.item_id and user_id = new.user_id) then raise exception 'item_not_found' using errcode = 'P0002'; end if;
    if (select count(*) from product_watches where user_id = new.user_id) >= 100 then raise exception 'too_many_watches' using errcode = '23514'; end if;
  else
    if new.user_id <> old.user_id or new.item_id <> old.item_id or new.product_key <> old.product_key or new.currency <> old.currency then raise exception 'immutable_column' using errcode = '42501'; end if;
    if new.target_price is distinct from old.target_price or new.min_drop_pct is distinct from old.min_drop_pct then new.last_alert_at := null; end if;      -- a changed rule deserves a fresh chance to fire
  end if;
  return new;
end $$;
drop trigger if exists product_watches_guard_trg on product_watches;
create trigger product_watches_guard_trg before insert or update on product_watches for each row execute function product_watches_guard();

alter table product_watches enable row level security;
alter table price_observations enable row level security;
alter table push_subscriptions enable row level security;
alter table price_alert_log enable row level security;
revoke all on product_watches, price_observations, push_subscriptions, price_alert_log from anon, authenticated;
drop policy if exists product_watches_owner on product_watches;
create policy product_watches_owner on product_watches for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, delete on product_watches to authenticated;
grant update (target_price, min_drop_pct, active) on product_watches to authenticated;           -- creation goes through the API (product_key is derived server-side)
drop policy if exists push_subscriptions_owner on push_subscriptions;
create policy push_subscriptions_owner on push_subscriptions for select to authenticated using (user_id = auth.uid());
grant select on push_subscriptions to authenticated;
drop policy if exists price_alert_log_owner on price_alert_log;
create policy price_alert_log_owner on price_alert_log for select to authenticated using (user_id = auth.uid());
grant select on price_alert_log to authenticated;
-- price_observations: server only (it holds observer ids).

-- ---------------------------------------------------------------------------------------------------------------------
-- Median of the last 90 days. Each observer counts once per day (their median that day), so one person spamming a product cannot move it.
-- Fewer than 3 daily points -> NULL ("not enough history").
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function price_median_90d(p_key text, p_currency text) returns table (median numeric, points int)
language sql stable security definer set search_path = public as $$
  with daily as (
    select percentile_cont(0.5) within group (order by price) as p
    from price_observations
    where product_key = p_key and currency = p_currency and observed_at > now() - interval '90 days'
    group by observer_id, (observed_at at time zone 'utc')::date)
  select case when count(*) >= 3 then round((percentile_cont(0.5) within group (order by p))::numeric, 2) end, count(*)::int from daily;
$$;

-- Record one observation from a user's browser. Only for products the user is actively watching; throttled; returns the median BEFORE this price.
create or replace function price_observe(p_user uuid, p_key text, p_price numeric, p_currency text, p_source text default 'extension')
returns jsonb language plpgsql security definer set search_path = public as $$
declare med numeric; pts int; oid bigint;
begin
  if not exists (select 1 from product_watches where user_id = p_user and product_key = p_key and active) then
    return jsonb_build_object('recorded', false, 'reason', 'not_watching');
  end if;
  if (select count(*) from price_observations where observer_id = p_user and observed_at > now() - interval '24 hours') >= 300 then
    return jsonb_build_object('recorded', false, 'reason', 'rate_limited');
  end if;
  if exists (select 1 from price_observations where observer_id = p_user and product_key = p_key and observed_at > now() - interval '30 minutes') then
    return jsonb_build_object('recorded', false, 'reason', 'throttled');
  end if;
  select m.median, m.points into med, pts from price_median_90d(p_key, p_currency) m;
  insert into price_observations (product_key, price, currency, source, observer_id) values (p_key, p_price, p_currency, p_source, p_user) returning id into oid;
  update product_watches set last_price = p_price, last_seen_at = now() where user_id = p_user and product_key = p_key and currency = p_currency and active;
  return jsonb_build_object('recorded', true, 'observation_id', oid, 'median', med, 'points', pts);
end $$;

-- Who should be told about this price? Atomically CLAIMS each qualifying watch (sets last_alert_at), so two parallel observations cannot both alert.
-- A watch qualifies when: active, same product and currency, price <= target, at least min_drop_pct under the 90-day median (if there is one), and
-- no alert in the last 7 days. Trust: the watcher's own browser is believed; anyone else's report only counts once two different users saw
-- the same price (within 2%) in the last 24 hours, so a single fake report cannot trigger alerts for other people.
-- p_limit caps how many alerts one observation can fan out (the rest are claimed by the next observation).
create or replace function price_claim_alerts(p_key text, p_price numeric, p_currency text, p_median numeric, p_observer uuid, p_limit int default 200)
returns table (watch_id uuid, user_id uuid, item_id uuid, target_price numeric, currency text, prior_alert_at timestamptz, title text, url text, email text, own boolean)
language plpgsql security definer set search_path = public as $$
declare corroborated boolean;
begin
  select count(distinct o.observer_id) >= 2 into corroborated from price_observations o
   where o.product_key = p_key and o.currency = p_currency and o.observed_at > now() - interval '24 hours'
     and o.price between p_price * 0.98 and p_price * 1.02 and o.observer_id is not null;
  return query
  with due as (
    select w.id, w.last_alert_at as prior from product_watches w
    where w.product_key = p_key and w.active and w.currency = p_currency and p_price <= w.target_price
      and (p_median is null or w.min_drop_pct = 0 or p_price <= p_median * (1 - w.min_drop_pct / 100))
      and (w.last_alert_at is null or w.last_alert_at <= now() - interval '7 days')
      and (w.user_id = p_observer or corroborated)
    order by w.last_alert_at nulls first, w.id
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update of w skip locked),
  upd as (
    update product_watches pw set last_alert_at = now() from due d where pw.id = d.id
    returning pw.id, pw.user_id, pw.item_id, pw.target_price, pw.currency, d.prior)
  select u.id, u.user_id, u.item_id, u.target_price, u.currency, u.prior, i.title, i.url, au.email::text, (u.user_id = p_observer)
  from upd u join oneclist_items i on i.id = u.item_id join auth.users au on au.id = u.user_id;
end $$;

-- Delivery failed on every channel: give the claim back so the next observation can retry (only if nothing else claimed it since).
create or replace function price_release_claim(p_watch uuid, p_prior timestamptz) returns void language sql security definer set search_path = public as $$
  update product_watches set last_alert_at = p_prior where id = p_watch and last_alert_at > now() - interval '5 minutes';
$$;
create or replace function price_log_alert(p_watch uuid, p_user uuid, p_price numeric, p_currency text, p_channels text[], p_status text) returns void
language sql security definer set search_path = public as $$
  insert into price_alert_log (watch_id, user_id, price, currency, channels, status) values (p_watch, p_user, p_price, p_currency, coalesce(p_channels, '{}'), p_status);
$$;
create or replace function price_watch_keys(p_user uuid) returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct product_key), '{}') from product_watches where user_id = p_user and active;
$$;
create or replace function price_deactivate_watch(p_watch uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin update product_watches set active = false where id = p_watch and active; return found; end $$;
create or replace function price_prune() returns int language sql security definer set search_path = public as $$
  with d as (delete from price_observations where observed_at < now() - interval '120 days' returning 1),
       l as (delete from price_alert_log where created_at < now() - interval '365 days' returning 1)
  select ((select count(*) from d) + (select count(*) from l))::int;
$$;

revoke all on function price_median_90d(text, text), price_observe(uuid, text, numeric, text, text), price_claim_alerts(text, numeric, text, numeric, uuid, int),
  price_release_claim(uuid, timestamptz), price_log_alert(uuid, uuid, numeric, text, text[], text), price_watch_keys(uuid), price_deactivate_watch(uuid), price_prune()
  from public, anon, authenticated;
grant execute on function price_median_90d(text, text), price_observe(uuid, text, numeric, text, text), price_claim_alerts(text, numeric, text, numeric, uuid, int),
  price_release_claim(uuid, timestamptz), price_log_alert(uuid, uuid, numeric, text, text[], text), price_watch_keys(uuid), price_deactivate_watch(uuid), price_prune()
  to service_role;

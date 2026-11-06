-- 014: Instant Code Snippet Extractor. Needs oneclist_items (001) for the optional link back to the bookmark the code came from.
-- Snippets are private to their owner. All writes go through save_snippets() so the size/rate caps cannot be bypassed from the REST API.

create table if not exists code_snippets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  item_id      uuid references oneclist_items(id) on delete set null,            -- the saved bookmark this came from, when there is one
  title        text not null check (char_length(title) between 1 and 120),
  language     text not null default 'text' check (language ~ '^[a-z0-9+#-]{1,20}$'),
  code         text not null check (char_length(code) between 2 and 20000),
  source_url   text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 2048)),
  source_title text check (source_title is null or char_length(source_title) <= 200),
  note         text check (note is null or char_length(note) <= 1000),
  code_hash    text generated always as (md5(code)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 'simple' on purpose: English stemming mangles identifiers (useEffect, parseInt, kubectl).
  fts          tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || language || ' ' || coalesce(source_title,'') || ' ' || coalesce(note,'') || ' ' || left(code, 20000))) stored,
  unique (user_id, code_hash)                                                      -- the same snippet is stored once per user
);
create index if not exists code_snippets_user_idx on code_snippets (user_id, created_at desc, id);
create index if not exists code_snippets_lang_idx on code_snippets (user_id, language);
create index if not exists code_snippets_fts_idx  on code_snippets using gin (fts);
create index if not exists code_snippets_item_idx on code_snippets (item_id) where item_id is not null;

alter table code_snippets enable row level security;
drop policy if exists code_snippets_owner_read on code_snippets;
create policy code_snippets_owner_read on code_snippets for select to authenticated using (user_id = auth.uid());
drop policy if exists code_snippets_owner_update on code_snippets;
create policy code_snippets_owner_update on code_snippets for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists code_snippets_owner_delete on code_snippets;
create policy code_snippets_owner_delete on code_snippets for delete to authenticated using (user_id = auth.uid());
revoke all on code_snippets from anon;
revoke insert, update on code_snippets from authenticated;
grant select, delete on code_snippets to authenticated;
grant update (title, note, language, updated_at) on code_snippets to authenticated;     -- code itself is immutable: edit = delete + save

-- Generic fixed-window rate limiter for expensive endpoints (server-side fetches). True = allowed.
create table if not exists api_rate (
  user_id      uuid not null references auth.users(id) on delete cascade,
  key          text not null,
  window_start timestamptz not null,
  n            int not null default 0,
  primary key (user_id, key, window_start)
);
alter table api_rate enable row level security;
revoke all on api_rate from anon, authenticated;
create or replace function rate_hit(p_user uuid, p_key text, p_limit int, p_window_s int) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s); c int;
begin
  delete from api_rate where user_id = p_user and key = p_key and window_start < now() - interval '1 day';
  insert into api_rate(user_id, key, window_start, n) values (p_user, p_key, w, 1)
    on conflict (user_id, key, window_start) do update set n = api_rate.n + 1 returning n into c;
  return c <= p_limit;
end $$;
revoke all on function rate_hit(uuid, text, int, int) from public, anon, authenticated;
grant execute on function rate_hit(uuid, text, int, int) to service_role;

-- Batch save. p_items: [{"title","language","code","note"}] (already cleaned by the API; re-checked by the table constraints).
-- Caps: 20 per call, 300 per rolling day, 5000 per user. Duplicates (same code) and anything over the daily cap are skipped (reported as 'skipped'), not errors.
create or replace function save_snippets(p_user uuid, p_source_url text, p_source_title text, p_url_key text, p_item_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; today int; remaining int; item uuid; ids uuid[]; saved int;
begin
  if p_user is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid'; end if;
  n := jsonb_array_length(p_items);
  if n = 0 or n > 20 then raise exception 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('snip:' || p_user::text, 0));      -- serialise per user so parallel saves can't overshoot the caps

  if (select count(*) from code_snippets where user_id = p_user) >= 5000 then raise exception 'vault_full'; end if;
  select count(*) into today from code_snippets where user_id = p_user and created_at > now() - interval '1 day';
  remaining := 300 - today;
  if remaining <= 0 then raise exception 'daily_limit'; end if;

  if p_item_id is not null then select id into item from oneclist_items where id = p_item_id and user_id = p_user; end if;
  if item is null and p_url_key is not null then select id into item from oneclist_items where user_id = p_user and url_key = p_url_key limit 1; end if;

  with src as (
    select e.ord, left(btrim(coalesce(nullif(btrim(e.j->>'title'), ''), 'Snippet')), 120) as title,
           case when lower(coalesce(e.j->>'language', '')) ~ '^[a-z0-9+#-]{1,20}$' then lower(e.j->>'language') else 'text' end as language,
           e.j->>'code' as code, nullif(left(btrim(coalesce(e.j->>'note', '')), 1000), '') as note
    from jsonb_array_elements(p_items) with ordinality as e(j, ord)
    where char_length(coalesce(e.j->>'code', '')) between 2 and 20000
    order by e.ord limit remaining
  ), ins as (
    insert into code_snippets(user_id, item_id, title, language, code, source_url, source_title, note)
    select p_user, item, title, language, code, case when p_source_url ~* '^https?://' and char_length(p_source_url) <= 2048 then p_source_url end,      -- never store a non-web source
           left(p_source_title, 200), note from src order by ord
    on conflict (user_id, code_hash) do nothing returning id
  )
  select coalesce(array_agg(id), '{}'), count(*) into ids, saved from ins;
  return jsonb_build_object('saved', saved, 'skipped', n - saved, 'ids', to_jsonb(ids), 'item_id', item);
end $$;
revoke all on function save_snippets(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function save_snippets(uuid, text, text, text, uuid, jsonb) to service_role;

create or replace function snippet_languages(p_user uuid) returns table (language text, n bigint)
language sql stable security definer set search_path = public as $$
  select language, count(*) from code_snippets where user_id = p_user group by language order by count(*) desc, language limit 40;
$$;
revoke all on function snippet_languages(uuid) from public, anon, authenticated;
grant execute on function snippet_languages(uuid) to service_role;

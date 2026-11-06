-- 015: Deep Cite. Highlights (a quoted passage + where it came from) and per-page citation details.
-- Needs oneclist_items (001) and rate_hit/api_rate (014). Private to the owner. Writes go through save_highlight()/set_cite_meta(),
-- so the size and rate caps cannot be bypassed from the REST API.

create table if not exists highlights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  item_id      uuid references oneclist_items(id) on delete set null,          -- the saved bookmark of the same page, when there is one
  source_url   text not null check (source_url ~* '^https?://' and char_length(source_url) <= 2048),
  url_key      text not null check (char_length(url_key) between 1 and 2048),
  source_title text check (source_title is null or char_length(source_title) <= 300),
  quote        text not null check (char_length(quote) between 3 and 2000),
  prefix       text check (prefix is null or char_length(prefix) <= 120),       -- a few words before/after: lets a short quote find the right occurrence
  suffix       text check (suffix is null or char_length(suffix) <= 120),
  note         text check (note is null or char_length(note) <= 1000),
  quote_hash   text generated always as (md5(quote)) stored,
  created_at   timestamptz not null default now(),
  fts          tsvector generated always as (to_tsvector('english', coalesce(source_title,'') || ' ' || quote || ' ' || coalesce(note,''))) stored,
  unique (user_id, url_key, quote_hash)                                         -- the same passage on the same page is stored once
);
create index if not exists highlights_user_idx on highlights (user_id, created_at desc, id);
create index if not exists highlights_page_idx on highlights (user_id, url_key);
create index if not exists highlights_fts_idx  on highlights using gin (fts);
create index if not exists highlights_item_idx on highlights (item_id) where item_id is not null;

-- Citation details per page and per user (authors, date, journal, DOI). Collected by the extension from the page's own meta tags
-- and editable by the user, so it is stored as plain bounded text, never trusted as markup.
create table if not exists citation_meta (
  user_id    uuid not null references auth.users(id) on delete cascade,
  url_key    text not null check (char_length(url_key) between 1 and 2048),
  title      text check (title is null or char_length(title) <= 300),
  authors    text[] not null default '{}' check (cardinality(authors) <= 30),
  published  text check (published is null or published ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$'),
  container  text check (container is null or char_length(container) <= 200),   -- site name or journal
  publisher  text check (publisher is null or char_length(publisher) <= 200),
  doi        text check (doi is null or doi ~ '^10\.[0-9]{4,9}/[^\s]{1,200}$'),
  updated_at timestamptz not null default now(),
  edited     boolean not null default false,                                      -- true once the user has corrected it: automatic fills never overwrite
  primary key (user_id, url_key)
);

alter table highlights enable row level security;
alter table citation_meta enable row level security;
revoke all on highlights, citation_meta from anon;
revoke insert, update, delete on highlights, citation_meta from authenticated;
grant select, delete on highlights to authenticated;
grant update (note) on highlights to authenticated;
grant select on citation_meta to authenticated;
drop policy if exists highlights_owner_read on highlights;
create policy highlights_owner_read on highlights for select to authenticated using (user_id = auth.uid());
drop policy if exists highlights_owner_update on highlights;
create policy highlights_owner_update on highlights for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists highlights_owner_delete on highlights;
create policy highlights_owner_delete on highlights for delete to authenticated using (user_id = auth.uid());
drop policy if exists citation_meta_owner_read on citation_meta;
create policy citation_meta_owner_read on citation_meta for select to authenticated using (user_id = auth.uid());

-- Cleans one authors array element: trims, collapses spaces, drops empties and over-long names.
create or replace function _clean_authors(p jsonb) returns text[] language sql immutable as $$
  select coalesce(array(
    select left(btrim(regexp_replace(a, '\s+', ' ', 'g')), 120)
    from (select distinct on (lower(btrim(x))) btrim(x) as a, o from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as e(x, o)
          order by lower(btrim(x)), o) d
    where char_length(btrim(a)) between 2 and 120 order by o limit 30), '{}'::text[]);
$$;

-- Save one highlight. p_meta (optional) = {"title","authors":[...],"published","container","publisher","doi"} from the page; it fills
-- citation_meta only for fields the user has not edited, and never blanks a value that is already there.
-- Caps: 5,000 per user, 300 per rolling day, 200 per page. A repeat of the same passage returns {"duplicate":true,"id":...}.
create or replace function save_highlight(p_user uuid, p_url text, p_url_key text, p_title text, p_quote text, p_prefix text, p_suffix text, p_note text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text; hid uuid; item uuid; today int; dup uuid; m jsonb := coalesce(p_meta, '{}'::jsonb); au text[]; pub text; doi text;
begin
  if p_user is null then raise exception 'not_authenticated'; end if;
  if p_url is null or p_url !~* '^https?://' or char_length(p_url) > 2048 or coalesce(p_url_key, '') = '' then raise exception 'invalid'; end if;
  q := btrim(regexp_replace(coalesce(p_quote, ''), '\s+', ' ', 'g'));
  if char_length(q) < 3 or char_length(q) > 2000 then raise exception 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hl:' || p_user::text, 0));

  select id into dup from highlights where user_id = p_user and url_key = p_url_key and quote_hash = md5(q);
  if dup is not null then return jsonb_build_object('duplicate', true, 'id', dup); end if;

  if (select count(*) from highlights where user_id = p_user) >= 5000 then raise exception 'vault_full'; end if;
  select count(*) into today from highlights where user_id = p_user and created_at > now() - interval '1 day';
  if today >= 300 then raise exception 'daily_limit'; end if;
  if (select count(*) from highlights where user_id = p_user and url_key = p_url_key) >= 200 then raise exception 'page_limit'; end if;

  select id into item from oneclist_items where user_id = p_user and url_key = p_url_key limit 1;
  insert into highlights(user_id, item_id, source_url, url_key, source_title, quote, prefix, suffix, note)
  values (p_user, item, p_url, p_url_key, nullif(left(btrim(coalesce(p_title, '')), 300), ''), q,
          nullif(left(btrim(regexp_replace(coalesce(p_prefix, ''), '\s+', ' ', 'g')), 120), ''),
          nullif(left(btrim(regexp_replace(coalesce(p_suffix, ''), '\s+', ' ', 'g')), 120), ''),
          nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  returning id into hid;

  if jsonb_typeof(m) = 'object' and m <> '{}'::jsonb then
    au := _clean_authors(m->'authors');
    pub := case when (m->>'published') ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' then m->>'published' end;
    doi := case when (m->>'doi') ~ '^10\.[0-9]{4,9}/[^\s]{1,200}$' then m->>'doi' end;
    insert into citation_meta(user_id, url_key, title, authors, published, container, publisher, doi)
    values (p_user, p_url_key, nullif(left(btrim(coalesce(m->>'title', '')), 300), ''), au, pub,
            nullif(left(btrim(coalesce(m->>'container', '')), 200), ''), nullif(left(btrim(coalesce(m->>'publisher', '')), 200), ''), doi)
    on conflict (user_id, url_key) do update set
      title = case when citation_meta.edited then citation_meta.title else coalesce(citation_meta.title, excluded.title) end,
      authors = case when citation_meta.edited or cardinality(citation_meta.authors) > 0 then citation_meta.authors else excluded.authors end,
      published = case when citation_meta.edited then citation_meta.published else coalesce(citation_meta.published, excluded.published) end,
      container = case when citation_meta.edited then citation_meta.container else coalesce(citation_meta.container, excluded.container) end,
      publisher = case when citation_meta.edited then citation_meta.publisher else coalesce(citation_meta.publisher, excluded.publisher) end,
      doi = case when citation_meta.edited then citation_meta.doi else coalesce(citation_meta.doi, excluded.doi) end,
      updated_at = now();
  end if;
  return jsonb_build_object('duplicate', false, 'id', hid, 'item_id', item);
end $$;
revoke all on function save_highlight(uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function save_highlight(uuid, text, text, text, text, text, text, text, jsonb) to service_role;

-- The user's own correction of a page's citation details. Passing an empty/absent field clears it. Marks the row edited.
create or replace function set_cite_meta(p_user uuid, p_url_key text, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(p_meta, '{}'::jsonb); pub text; doi text;
begin
  if p_user is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_url_key, '') = '' or jsonb_typeof(m) <> 'object' then raise exception 'invalid'; end if;
  if not exists (select 1 from highlights where user_id = p_user and url_key = p_url_key) then raise exception 'not_found'; end if;   -- only for pages that have highlights
  if coalesce(m->>'published', '') <> '' and (m->>'published') !~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' then raise exception 'invalid_date'; end if;
  if coalesce(m->>'doi', '') <> '' and (m->>'doi') !~ '^10\.[0-9]{4,9}/[^\s]{1,200}$' then raise exception 'invalid_doi'; end if;
  pub := nullif(m->>'published', ''); doi := nullif(m->>'doi', '');
  insert into citation_meta(user_id, url_key, title, authors, published, container, publisher, doi, edited)
  values (p_user, p_url_key, nullif(left(btrim(coalesce(m->>'title', '')), 300), ''), _clean_authors(m->'authors'), pub,
          nullif(left(btrim(coalesce(m->>'container', '')), 200), ''), nullif(left(btrim(coalesce(m->>'publisher', '')), 200), ''), doi, true)
  on conflict (user_id, url_key) do update set title = excluded.title, authors = excluded.authors, published = excluded.published,
    container = excluded.container, publisher = excluded.publisher, doi = excluded.doi, edited = true, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function set_cite_meta(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function set_cite_meta(uuid, text, jsonb) to service_role;

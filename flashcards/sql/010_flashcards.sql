-- 010: spaced-repetition flashcards generated from saved bookmarks.
-- Needs: oneclist_items (001), archive text (009_archive: full_markdown_content) and/or OCR text (004: ocr_extracted_text).
alter table oneclist_items
  add column if not exists cards_status     text not null default 'none' check (cards_status in ('none','processing','done','failed','skipped')),
  add column if not exists cards_claimed_at timestamptz,
  add column if not exists cards_generated_at timestamptz,
  add column if not exists cards_error      text;                  -- short code only, never raw provider text

create table if not exists flashcards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  item_id          uuid not null references oneclist_items(id) on delete cascade,
  question         text not null check (char_length(question) between 8 and 400),
  answer           text not null check (char_length(answer) between 1 and 600),
  evidence         text check (evidence is null or char_length(evidence) <= 400),   -- verbatim quote from the page that supports the answer
  q_hash           text generated always as (md5(lower(btrim(regexp_replace(question, '\s+', ' ', 'g'))))) stored,
  state            text not null default 'new' check (state in ('new','learning','review','suspended')),
  ease             numeric(3,2) not null default 2.50 check (ease between 1.30 and 3.00),
  interval_days    int  not null default 0 check (interval_days >= 0),
  reps             int  not null default 0 check (reps >= 0),
  lapses           int  not null default 0 check (lapses >= 0),
  due_at           timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (item_id, q_hash)                                         -- regenerating never duplicates a card
);
create index if not exists flashcards_due_idx  on flashcards (user_id, due_at) where state in ('learning','review');
create index if not exists flashcards_new_idx  on flashcards (user_id, created_at) where state = 'new';
create index if not exists flashcards_item_idx on flashcards (item_id);

create table if not exists card_reviews (
  id            bigint generated always as identity primary key,
  card_id       uuid not null references flashcards(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  rating        smallint not null check (rating between 0 and 3),  -- 0 again, 1 hard, 2 good, 3 easy
  was_new       boolean not null,
  prev_interval int not null,
  new_interval  int not null,
  ease_after    numeric(3,2) not null,
  ms            int check (ms is null or ms between 0 and 600000),
  reviewed_at   timestamptz not null default now()
);
create index if not exists card_reviews_user_idx on card_reviews (user_id, reviewed_at desc);

alter table flashcards   enable row level security;
alter table card_reviews enable row level security;
drop policy if exists flashcards_owner_read on flashcards;
create policy flashcards_owner_read on flashcards for select to authenticated using (user_id = auth.uid());
drop policy if exists flashcards_owner_delete on flashcards;
create policy flashcards_owner_delete on flashcards for delete to authenticated using (user_id = auth.uid());
drop policy if exists flashcards_owner_update on flashcards;
create policy flashcards_owner_update on flashcards for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists reviews_owner_read on card_reviews;
create policy reviews_owner_read on card_reviews for select to authenticated using (user_id = auth.uid());
revoke all on flashcards, card_reviews from anon;
revoke insert, update on flashcards from authenticated;
grant select, delete on flashcards to authenticated;
grant update (state) on flashcards to authenticated;               -- users may suspend/unsuspend; scheduling columns are server-only
grant select on card_reviews to authenticated;

-- SM-2 (Anki-style), authoritative copy. lib/sm2.ts mirrors it for the interval previews on the buttons; test/ checks they agree.
--   0 Again : relearn in 10 min, ease -0.20, lapse+1 (8 lapses = leech: suspended)
--   1 Hard  : interval x1.2 (min 1 day), ease -0.15
--   2 Good  : 1 day, then 3 days, then interval x ease
--   3 Easy  : 4 days, then interval x ease x1.3, ease +0.15
-- Good/Easy always move the interval forward by at least a day. Ease stays within 1.30..3.00.
create or replace function review_card(p_user uuid, p_card uuid, p_rating int, p_ms int default null, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare c flashcards%rowtype; e int; iv int; r int; l int; st text; due timestamptz;
begin
  if p_rating not between 0 and 3 then raise exception 'bad_rating'; end if;
  select * into c from flashcards where id = p_card and user_id = p_user for update;     -- row lock: a double-submit cannot apply twice
  if not found then raise exception 'not_found'; end if;
  if c.state = 'suspended' then raise exception 'suspended'; end if;
  e := (c.ease * 100)::int; iv := c.interval_days; r := c.reps; l := c.lapses;
  if p_rating = 0 then
    l := l + 1; r := 0; iv := 0; e := greatest(130, e - 20);
    st := case when l >= 8 then 'suspended' else 'learning' end;
    due := p_now + interval '10 minutes';
  else
    if p_rating = 1 then iv := greatest(1, round(greatest(iv, 1) * 1.2)::int); e := greatest(130, e - 15);
    elsif p_rating = 2 then iv := case when r = 0 then 1 when r = 1 then 3 else greatest(iv + 1, round(iv * e / 100.0)::int) end;
    else iv := case when r = 0 then 4 else greatest(iv + 1, round(iv * e * 13 / 1000.0)::int) end; e := least(300, e + 15);
    end if;
    r := r + 1; st := 'review'; due := p_now + make_interval(days => iv);
  end if;
  update flashcards set state = st, ease = e / 100.0, interval_days = iv, reps = r, lapses = l, due_at = due, last_reviewed_at = p_now where id = p_card;
  insert into card_reviews(card_id, user_id, rating, was_new, prev_interval, new_interval, ease_after, ms, reviewed_at)
    values (p_card, p_user, p_rating, c.state = 'new', c.interval_days, iv, e / 100.0, p_ms, p_now);
  return jsonb_build_object('state', st, 'ease', e / 100.0, 'interval_days', iv, 'reps', r, 'lapses', l, 'due_at', due);
end $$;

-- Distinct local review days (for the streak). p_tz is an IANA zone name.
create or replace function review_days(p_user uuid, p_tz text, p_days int default 60)
returns table (day date) language sql stable security definer set search_path = public as $$
  select distinct (reviewed_at at time zone p_tz)::date from card_reviews
  where user_id = p_user and reviewed_at > now() - make_interval(days => least(greatest(p_days, 1), 400) + 1) order by 1 desc;
$$;
revoke all on function review_card(uuid, uuid, int, int, timestamptz) from public, anon, authenticated;
revoke all on function review_days(uuid, text, int) from public, anon, authenticated;
grant execute on function review_card(uuid, uuid, int, int, timestamptz) to service_role;      -- only the API (after requireUser) may call these
grant execute on function review_days(uuid, text, int) to service_role;

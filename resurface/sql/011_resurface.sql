-- 011: Buk's Morning Resurface. Needs oneclist_items with embedding + embedding_model (migration 004, pgvector).
alter table oneclist_items
  add column if not exists last_opened_at timestamptz,        -- set when the user opens a link from Bukmarkz; NULL = never opened
  add column if not exists shelved_at     timestamptz;        -- the "Archive" action: put away, never resurfaced (restore = set NULL)
create index if not exists oneclist_items_opened_idx on oneclist_items (user_id, last_opened_at);

create table if not exists resurface_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists daily_resurface (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  for_date       date not null,                                -- UTC date the batch was generated for
  item_ids       uuid[] not null default '{}',                -- ranked, best first
  picks          jsonb not null default '[]',                  -- per item: why it was chosen (unread, days_since, sim, score)
  status         text not null default 'ready' check (status in ('ready','empty')),   -- 'empty' = too few candidates today (recorded so the cron does not retry all night)
  quiz_question  text check (quiz_question is null or char_length(quiz_question) between 8 and 400),
  quiz_answer    text check (quiz_answer is null or char_length(quiz_answer) between 1 and 600),
  quiz_evidence  text check (quiz_evidence is null or char_length(quiz_evidence) <= 400),   -- verbatim quote from the saved page
  quiz_item_id   uuid references oneclist_items(id) on delete set null,
  quiz_status    text not null default 'pending' check (quiz_status in ('pending','processing','done','none','failed')),
  quiz_attempts  smallint not null default 0,
  quiz_claimed_at timestamptz,
  quiz_result    text check (quiz_result in ('got','missed')),
  created_at     timestamptz not null default now(),
  unique (user_id, for_date)                                   -- a retried cron can never create a second batch
);
create index if not exists daily_resurface_quiz_idx on daily_resurface (for_date, quiz_status) where status = 'ready' and quiz_status in ('pending','failed','processing');

alter table daily_resurface enable row level security;
alter table resurface_prefs enable row level security;
drop policy if exists resurface_owner_read on daily_resurface;
create policy resurface_owner_read on daily_resurface for select to authenticated using (user_id = auth.uid());
drop policy if exists prefs_owner on resurface_prefs;
create policy prefs_owner on resurface_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on daily_resurface, resurface_prefs from anon;
revoke insert, update, delete on daily_resurface from authenticated;                  -- written by the service role only
grant select on daily_resurface to authenticated;
grant select, insert, update on resurface_prefs to authenticated;

/*
 * generate_daily_resurface(user): choose up to 5 old bookmarks worth reopening today.
 *   candidates  saved 7+ days ago, a web link, not shelved, not opened in the last 14 days, not resurfaced in the last 14 days
 *   score       0.50 x similarity to the centroid of the last 7 days of saves   (items without a usable embedding get a neutral 0.30)
 *             + 0.30 x staleness (days since last touch / 180, capped at 1)
 *             + 0.20 x never opened (last_opened_at IS NULL)
 *   diversity   at most 2 links per domain
 * Similarity only compares vectors made by the same embedding model (vectors from different models are not comparable).
 * Idempotent per (user, date). Fewer than p_min candidates records an 'empty' batch rather than a weak one.
 */
create or replace function generate_daily_resurface(user_uuid uuid, p_for date default (now() at time zone 'utc')::date, p_count int default 5, p_min int default 3)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare existing uuid; model text; centroid vector; ids uuid[]; pk jsonb; new_id uuid;
begin
  select id into existing from daily_resurface where user_id = user_uuid and for_date = p_for;
  if existing is not null then return existing; end if;

  -- what the user has been saving this week: dominant embedding model, then the centroid of its newest 50 vectors
  select embedding_model into model from (
    select embedding_model, count(*) c from oneclist_items
    where user_id = user_uuid and created_at > now() - interval '7 days' and embedding is not null group by 1 order by c desc, 1 limit 1) m;
  if found then
    select avg(embedding) into centroid from (
      select embedding from oneclist_items
      where user_id = user_uuid and created_at > now() - interval '7 days' and embedding is not null and embedding_model is not distinct from model
      order by created_at desc limit 50) r;
  end if;

  with cand as (
    select i.id, i.last_opened_at is null as unread,
           greatest(0, extract(epoch from now() - coalesce(i.last_opened_at, i.created_at)) / 86400)::int as days_since,
           case when centroid is not null and i.embedding is not null and i.embedding_model is not distinct from model then 1 - (i.embedding <=> centroid) end as sim,
           coalesce(substring(i.url from '^https?://(?:www\.)?([^/?#:]+)'), i.url) as dom,
           i.created_at
    from oneclist_items i
    where i.user_id = user_uuid and i.status = 'bookmark' and i.url ~* '^https?://' and i.shelved_at is null
      and i.created_at <= now() - interval '7 days'
      and (i.last_opened_at is null or i.last_opened_at < now() - interval '14 days')
      and not exists (select 1 from daily_resurface d where d.user_id = user_uuid and d.created_at > now() - interval '14 days' and i.id = any(d.item_ids))
  ), scored as (
    select *, 0.50 * (case when sim is null then 0.30 else greatest(sim, 0) end) +   -- NB: GREATEST ignores NULLs, so a plain coalesce(greatest(..)) would never reach the neutral value
            0.30 * least(1.0, days_since / 180.0) + 0.20 * (unread)::int as score from cand
  ), capped as (
    select *, row_number() over (partition by dom order by score desc, created_at, id) as dom_rank from scored
  ), top as (
    select *, row_number() over (order by score desc, created_at, id) as rn from capped where dom_rank <= 2
  )
  select array_agg(id order by rn), jsonb_agg(jsonb_build_object('id', id, 'unread', unread, 'days_since', days_since, 'sim', round(sim::numeric, 2), 'score', round(score::numeric, 3)) order by rn)
    into ids, pk from top where rn <= p_count;

  if ids is null or cardinality(ids) < p_min then
    insert into daily_resurface(user_id, for_date, status, quiz_status) values (user_uuid, p_for, 'empty', 'none')
    on conflict (user_id, for_date) do nothing returning id into new_id;
  else
    insert into daily_resurface(user_id, for_date, item_ids, picks) values (user_uuid, p_for, ids, pk)
    on conflict (user_id, for_date) do nothing returning id into new_id;
  end if;
  if new_id is null then select id into new_id from daily_resurface where user_id = user_uuid and for_date = p_for; end if;
  return new_id;
end $$;

/* Users the nightly job still owes a batch: active in the last 30 days, not opted out, no batch for p_for yet.
   Because finished users drop out of this list, every cron invocation simply takes the next p_limit users: no cursor needed. */
create or replace function resurface_pending_users(p_limit int default 30, p_for date default (now() at time zone 'utc')::date)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select u.user_id from (
    select distinct i.user_id from oneclist_items i
    where i.created_at > now() - interval '30 days' or i.last_opened_at > now() - interval '30 days'
  ) u
  left join resurface_prefs p on p.user_id = u.user_id
  where coalesce(p.enabled, true)
    and not exists (select 1 from daily_resurface d where d.user_id = u.user_id and d.for_date = p_for)
  order by u.user_id limit least(greatest(p_limit, 1), 500);
$$;

revoke all on function generate_daily_resurface(uuid, date, int, int) from public, anon, authenticated;
revoke all on function resurface_pending_users(int, date) from public, anon, authenticated;
grant execute on function generate_daily_resurface(uuid, date, int, int) to service_role;           -- only the cron route (after CRON_SECRET) may call these
grant execute on function resurface_pending_users(int, date) to service_role;

/* Optional: run the picker inside Postgres instead of the Vercel cron, then let the API route fill the quizzes.
   select cron.schedule('resurface-picks', '30 0 * * *', $$ select generate_daily_resurface(user_id) from resurface_pending_users(500) $$); */

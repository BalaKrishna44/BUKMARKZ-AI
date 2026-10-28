-- 006: private podcast. One secret feed URL per user, many generated episodes.
create table if not exists podcast_feeds (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  token       text not null unique check (char_length(token) >= 32),   -- bearer secret inside the feed URL
  title       text not null default 'My Bukmarkz Briefing',
  description text not null default 'Articles and notes from my Bukmarkz vault, read aloud.',
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

create table if not exists podcast_episodes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Untitled episode',
  description     text not null default '',
  status          text not null default 'queued' check (status in ('queued','scripting','synthesizing','ready','failed')),
  source_item_ids uuid[] not null,
  style           text not null default 'conversation',
  target_minutes  int  not null default 8 check (target_minutes between 2 and 25),
  voice_a         text, voice_b text,
  script          jsonb,                       -- [{speaker:'A'|'B', text}]
  audio_key       text,                        -- R2 object key
  audio_bytes     bigint,
  duration_sec    int,
  attempts        int  not null default 0,
  error           text,
  locked_at       timestamptz,
  created_at      timestamptz not null default now(),
  published_at    timestamptz
);
create index if not exists podcast_episodes_user_idx on podcast_episodes (user_id, published_at desc) where status = 'ready';
create index if not exists podcast_episodes_queue_idx on podcast_episodes (created_at) where status in ('queued','scripting','synthesizing');

alter table podcast_feeds enable row level security;
alter table podcast_episodes enable row level security;
do $$ begin create policy pf_select on podcast_feeds for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy pe_select on podcast_episodes for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;
revoke insert, update, delete on podcast_feeds, podcast_episodes from anon, authenticated;

-- Claim one episode: new work, or work whose worker died (lock older than 15 min). Max 3 attempts.
create or replace function claim_next_episode()
returns setof podcast_episodes language sql security definer set search_path = public as $$
  update podcast_episodes e set status = 'scripting', locked_at = now(), attempts = e.attempts + 1
  where e.id = (
    select id from podcast_episodes
    where attempts < 3 and (status = 'queued' or (status in ('scripting','synthesizing') and locked_at < now() - interval '15 minutes'))
    order by created_at limit 1 for update skip locked)
  returning e.*;
$$;
revoke all on function claim_next_episode() from public, anon, authenticated;
grant execute on function claim_next_episode() to service_role;

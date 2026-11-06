-- 025: Anti-Hoarder digest v2. Picks links the user has NEVER opened (and not shelved), saved 14+ days ago, and returns Buk's source text (summary).
-- Order is "random but stable": md5(id || ISO-week) shuffles differently every week, yet a retried cron run in the same week picks the SAME 5
-- (random() would make a retry email different links than the first attempt; TABLESAMPLE is block-level, biased on small tables and ignores WHERE).
drop function if exists digest_pick_items(uuid, uuid[], int);
create function digest_pick_items(p_user uuid, p_exclude uuid[], p_limit int default 5)
returns table(id uuid, title text, url text, created_at timestamptz, summary text)
language sql stable security definer set search_path = public as $$
  select i.id, i.title, i.url, i.created_at, i.summary
  from oneclist_items i
  where i.user_id = p_user
    and not i.is_private
    and i.status = 'bookmark'
    and i.url ~* '^https?://'
    and i.last_opened_at is null                      -- never opened from Bukmarkz
    and i.shelved_at is null                          -- not archived
    and i.created_at < now() - interval '14 days'
    and not (i.id = any(coalesce(p_exclude, '{}')))   -- not shown last week
  order by md5(i.id::text || to_char(now(), 'IYYY-IW'))
  limit greatest(1, least(p_limit, 10));
$$;
revoke all on function digest_pick_items(uuid, uuid[], int) from public, anon, authenticated;
grant execute on function digest_pick_items(uuid, uuid[], int) to service_role;

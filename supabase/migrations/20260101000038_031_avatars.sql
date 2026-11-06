-- 031: profile pictures. One row per user holding the avatar address, and a public `avatars` bucket.
-- Browsers NEVER write to storage or to this table: the /api/profile/avatar route validates, re-encodes and writes with the service role.
-- (creator_profiles.avatar_url from 012 is kept in sync by the route so public Stacks show the same picture.)
create table if not exists user_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url ~ '^https://[^/]+/storage/v1/object/public/avatars/[0-9a-f-]{36}/[0-9a-f]{16}\.jpg$')),
  updated_at timestamptz not null default now()
);
alter table user_profiles enable row level security;
drop policy if exists user_profiles_read_own on user_profiles;
create policy user_profiles_read_own on user_profiles for select to authenticated using (user_id = auth.uid());
revoke all on user_profiles from anon, authenticated;
grant select on user_profiles to authenticated;          -- no insert/update/delete: service role only

-- Public bucket (anyone with the link can read a 256x256 avatar), JPEG only, 256 KB hard cap. No storage policies are created for
-- authenticated/anon, so direct uploads from the browser are refused.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 262144, array['image/jpeg'])
    on conflict (id) do update set public = true, file_size_limit = 262144, allowed_mime_types = array['image/jpeg'];
  end if;
end $$;

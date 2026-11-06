-- Seeds public "starter" stacks owned by ONE account you control (e.g. a "bukmarkz" account).
-- Needs the handle 'bukmarkz' to be free (or already owned by the owner account); the script fails loudly otherwise.
-- Usage: psql "$DATABASE_URL" -v owner="'<uuid of that auth user>'" -f seed_starter_stacks.sql
-- Review and edit every link before running: these point at official documentation homepages that should stay stable,
-- but you are responsible for what you publish under your brand. Safe to re-run (upserts by slug).
insert into creator_profiles(user_id, handle) values (:owner::uuid, 'bukmarkz') on conflict (user_id) do nothing;

with defs(slug, title, description, theme) as (values
  ('starter-postgres-vectors', 'Postgres and vector search', 'Official docs to learn Postgres, pgvector and row-level security.', 'ocean'),
  ('starter-web-platform', 'Web platform essentials', 'Reference docs for the web: HTML, CSS, JavaScript and React.', 'mint'),
  ('starter-nextjs-supabase', 'Next.js + Supabase starter', 'Docs for building and deploying a Next.js app on Supabase.', 'violet'))
insert into stacks(user_id, slug, title, description, theme, is_public, is_starter)
select :owner::uuid, slug, title, description, theme, true, true from defs
on conflict (slug) do update set title = excluded.title, description = excluded.description, theme = excluded.theme, is_starter = true, is_public = true, updated_at = now();

delete from stack_items where stack_id in (select id from stacks where is_starter and user_id = :owner::uuid);
insert into stack_items(stack_id, position, title, url, blurb)
select s.id, v.pos, v.title, v.url, v.blurb from (values
  ('starter-postgres-vectors', 0, 'PostgreSQL documentation', 'https://www.postgresql.org/docs/', 'The official manual.'),
  ('starter-postgres-vectors', 1, 'pgvector on GitHub', 'https://github.com/pgvector/pgvector', 'Vector similarity search for Postgres.'),
  ('starter-postgres-vectors', 2, 'Supabase: Row Level Security', 'https://supabase.com/docs/guides/database/postgres/row-level-security', 'Policies that protect each user''s rows.'),
  ('starter-web-platform', 0, 'MDN Web Docs', 'https://developer.mozilla.org/', 'The reference for HTML, CSS and JavaScript.'),
  ('starter-web-platform', 1, 'React documentation', 'https://react.dev/', 'Learn and reference React.'),
  ('starter-web-platform', 2, 'web.dev', 'https://web.dev/', 'Guides on performance, accessibility and PWAs.'),
  ('starter-nextjs-supabase', 0, 'Next.js documentation', 'https://nextjs.org/docs', 'App Router, routing and deployment.'),
  ('starter-nextjs-supabase', 1, 'Supabase documentation', 'https://supabase.com/docs', 'Auth, database, storage and edge functions.'),
  ('starter-nextjs-supabase', 2, 'Supabase Auth with Next.js', 'https://supabase.com/docs/guides/auth/server-side/nextjs', 'Server-side auth setup.')
) as v(slug, pos, title, url, blurb) join stacks s on s.slug = v.slug and s.user_id = :owner::uuid;

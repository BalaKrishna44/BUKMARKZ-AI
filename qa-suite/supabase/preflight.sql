-- Read-only production pre-flight audit.  Run in the Supabase SQL editor (as postgres) or:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/preflight.sql
-- Every row is  (item, status, detail).  status = FAIL (fix before launch) | WARN (decide) | INFO | PASS.   Changes nothing.
-- Set the projection first if you want it:   \set target_rows 500000   \set embed_dim 1536   \set hnsw_m 16
\if :{?target_rows} \else \set target_rows 200000 \endif
\if :{?embed_dim} \else \set embed_dim 1536 \endif
\if :{?hnsw_m} \else \set hnsw_m 16 \endif

with
rls_off as (
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
),
definer_no_path as (
  select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
),
definer_open as (    -- security definer functions that anon or PUBLIC can call: each one must be a deliberate public API
  select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')
),
views_bypass as (    -- a view runs with its OWNER's rights unless security_invoker=true, which silently bypasses RLS
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' and not coalesce('security_invoker=true' = any (c.reloptions), false) and not coalesce('security_invoker=on' = any (c.reloptions), false)
),
anon_table_grants as (
  select c.relname, string_agg(distinct g.privilege_type, ',') as privs
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join information_schema.role_table_grants g on g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'anon'
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') group by c.relname
),
open_policies as (
  select tablename || '.' || policyname || ' (' || cmd || ' to ' || array_to_string(roles, ',') || ')' as pol from pg_policies
  where schemaname = 'public' and (qual in ('true', '(true)') or with_check in ('true', '(true)')) 
),
bad_idx as (select c.relname from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not i.indisvalid),
vec as (
  select ic.relname as idx, tc.relname as tbl, am.amname as method, pg_relation_size(ic.oid) as bytes, greatest(tc.reltuples, 0)::bigint as rows
  from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class tc on tc.oid = i.indrelid join pg_am am on am.oid = ic.relam join pg_namespace n on n.oid = tc.relnamespace
  where n.nspname = 'public' and am.amname in ('hnsw', 'ivfflat')
)
select * from (
  select '1  RLS enabled on every public table' as item, case when count(*) = 0 then 'PASS' else 'FAIL' end as status, coalesce(string_agg(relname, ', '), 'all tables protected') as detail from rls_off
  union all select '2  SECURITY DEFINER functions pin search_path', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(fn, ', '), 'all pinned') from definer_no_path
  union all select '3  views run as the caller (security_invoker)', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(relname, ', '), 'no view bypasses RLS') from views_bypass
  union all select '4  anon can EXECUTE these security-definer functions (each must be an intended public API)', case when count(*) = 0 then 'PASS' else 'WARN' end, coalesce(string_agg(fn, ', '), 'none') from definer_open
  union all select '5  anon has table privileges on (RLS is the only wall; prefer REVOKE)', case when count(*) = 0 then 'PASS' else 'WARN' end, coalesce(string_agg(relname || ' [' || privs || ']', ', '), 'none') from anon_table_grants
  union all select '6  policies that are literally "true"', case when count(*) = 0 then 'PASS' else 'WARN' end, coalesce(string_agg(pol, '; '), 'none') from open_policies
  union all select '7  no INVALID indexes (failed CONCURRENTLY build)', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(relname, ', '), 'none') from bad_idx
  union all select '8  pgvector installed', case when count(*) > 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(extversion, ','), 'missing') from pg_extension where extname = 'vector'
  union all select '9  vector index (measured): ' || idx || ' on ' || tbl || ' [' || method || ']', 'INFO',
         pg_size_pretty(bytes) || ' for ~' || rows || ' rows = ' || case when rows > 0 then (bytes / rows) || ' bytes/row' else 'n/a' end from vec
  union all select '10 HNSW working-set projection at ' || :'target_rows' || ' vectors (dim ' || :'embed_dim' || ', m ' || :'hnsw_m' || ')', 'INFO',
         pg_size_pretty((:target_rows::numeric * (4 * :embed_dim + 2 * 8 * :hnsw_m + 56))::bigint) || ' index; keep it inside shared_buffers+OS cache, and set maintenance_work_mem at least this large for the BUILD (else it spills and takes hours)'
  union all select '11 memory settings', 'INFO', 'shared_buffers=' || current_setting('shared_buffers') || ', maintenance_work_mem=' || current_setting('maintenance_work_mem') || ', work_mem=' || current_setting('work_mem') || ', max_parallel_maintenance_workers=' || current_setting('max_parallel_maintenance_workers')
  union all select '12 maintenance_work_mem large enough to build the biggest vector index in memory', case when coalesce((select max(bytes) from vec), 0) <= pg_size_bytes(current_setting('maintenance_work_mem')) then 'PASS' else 'WARN' end,
         'biggest index ' || pg_size_pretty(coalesce((select max(bytes) from vec), 0)) || ' vs maintenance_work_mem ' || current_setting('maintenance_work_mem') || ' (raise it for the session that runs CREATE INDEX / REINDEX)'
  union all select '13 vector indexes exist for every embedding column', case when (select count(*) from vec) >= 1 then 'PASS' else 'FAIL' end, (select count(*)::text || ' vector index(es)' from vec)
) r order by item;

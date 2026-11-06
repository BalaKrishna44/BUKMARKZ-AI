-- Minimal pgTAP stand-in for machines without the pgtap extension (this repo's CI sandbox). On Supabase use the real extension:
--   create extension if not exists pgtap with schema extensions;  then  supabase test db
-- Implements only what rls.test.sql uses: plan, ok, is, isnt, throws_ok(sql, errcode, errmsg, desc), lives_ok, is_empty, finish.
-- State lives in GUCs, so no table privileges are needed when the test is running as anon/authenticated.
create or replace function plan(n int) returns text language plpgsql as $$
begin perform set_config('tap.plan', n::text, false); perform set_config('tap.n', '0', false); perform set_config('tap.failed', '0', false); return '1..' || n; end $$;
create or replace function _tap(passed boolean, descr text, diag text default null) returns text language plpgsql as $$
declare n int := coalesce(nullif(current_setting('tap.n', true), ''), '0')::int + 1; out text;
begin
  perform set_config('tap.n', n::text, false);
  if passed is not true then perform set_config('tap.failed', (coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int + 1)::text, false); end if;
  out := case when passed is true then 'ok ' else 'not ok ' end || n || coalesce(' - ' || descr, '') || case when passed is true or diag is null then '' else E'\n#   ' || diag end;
  return out;
end $$;
create or replace function ok(passed boolean, descr text default null) returns text language sql as $$ select _tap($1, $2) $$;
create or replace function is(have anyelement, want anyelement, descr text default null) returns text language sql as
$$ select _tap(have is not distinct from want, descr, format('have: %L, want: %L', have, want)) $$;
create or replace function isnt(have anyelement, want anyelement, descr text default null) returns text language sql as
$$ select _tap(have is distinct from want, descr, format('did not want: %L', have)) $$;
create or replace function throws_ok(q text, errcode text, errmsg text, descr text default null) returns text language plpgsql as $$
begin
  execute q;
  return _tap(false, descr, 'no exception was raised');
exception when others then
  return _tap((errcode is null or sqlstate = errcode) and (errmsg is null or sqlerrm = errmsg), descr, format('got %s: %s (wanted %s / %s)', sqlstate, sqlerrm, errcode, errmsg));
end $$;
create or replace function lives_ok(q text, descr text default null) returns text language plpgsql as $$
begin execute q; return _tap(true, descr);
exception when others then return _tap(false, descr, format('raised %s: %s', sqlstate, sqlerrm)); end $$;
create or replace function is_empty(q text, descr text default null) returns text language plpgsql as $$
declare n int;
begin execute format('select count(*) from (%s) _t', q) into n; return _tap(n = 0, descr, format('%s row(s) returned', n));
exception when others then return _tap(false, descr, format('raised %s: %s', sqlstate, sqlerrm)); end $$;
create or replace function finish() returns setof text language plpgsql as $$
declare p int := nullif(current_setting('tap.plan', true), '')::int; n int := nullif(current_setting('tap.n', true), '')::int; f int := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int;
begin
  if n is distinct from p then return next format('# Looks like you planned %s tests but ran %s', p, n); end if;
  if f > 0 then return next format('# Looks like you failed %s test(s) of %s', f, n); end if;
  if n is not distinct from p and f = 0 then return next '# ok: all ' || n || ' tests passed'; end if;
end $$;

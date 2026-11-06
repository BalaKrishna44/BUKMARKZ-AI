\set ON_ERROR_STOP on
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if not c then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
create or replace function as_user(u text, q text) returns text language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u,''), false); execute 'set local role ' || case when u is null then 'anon' else 'authenticated' end;
  begin execute q; reset role; return 'OK'; exception when others then reset role; return sqlerrm; end; end $$;
grant execute on function ok(boolean,text), as_user(text,text) to public;
set client_min_messages = notice;
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
insert into auth.users values (:'A'),(:'B');
insert into oneclist_items(user_id, url_key) values (:'A', 'example.com/post'), (:'B', 'example.com/post');
select id as ia from oneclist_items where user_id = :'A' \gset
select id as ib from oneclist_items where user_id = :'B' \gset

-- basic save, auto-link by url_key
select save_snippets(:'A', 'https://example.com/post', 'A post', 'example.com/post', null, '[{"title":"Pool","language":"JS","code":"const a = 1;\nconst b = 2;","note":"n"},{"title":"Q","language":"sql","code":"select 1;\nselect 2;"}]') as r \gset
select ok((:'r'::jsonb->>'saved')::int = 2 and (:'r'::jsonb->>'skipped')::int = 0, 'two snippets saved');
select ok((select item_id from code_snippets where user_id = :'A' and title = 'Pool') = :'ia'::uuid, 'auto-linked to the user''s own bookmark of the same page');
select ok((select language from code_snippets where title = 'Pool') = 'js', 'language lower-cased');
select ok((select count(*) from code_snippets where user_id = :'A' and item_id = :'ib'::uuid) = 0, 'never links to another user''s bookmark (url_key lookup is per user)');
select save_snippets(:'A', null, null, null, :'ib', '[{"title":"X","code":"print(1)\nprint(2)"}]') as r2 \gset
select ok((select item_id from code_snippets where title = 'X') is null, 'explicit item_id of someone else''s bookmark is ignored');

-- dedupe
select ok((save_snippets(:'A', null, null, null, null, '[{"title":"again","code":"const a = 1;\nconst b = 2;"}]')->>'skipped')::int = 1, 'same code again -> skipped, not an error');
select ok((save_snippets(:'B', null, null, null, null, '[{"title":"mine","code":"const a = 1;\nconst b = 2;"}]')->>'saved')::int = 1, 'another user can save the same code');
select ok((save_snippets(:'B', null, null, null, null, '[{"title":"d1","code":"dup dup dup 1"},{"title":"d2","code":"dup dup dup 1"}]')->>'saved')::int = 1, 'duplicates inside one batch -> saved once');

-- validation
select ok(as_user(null, $q$select 1$q$) = 'OK', 'harness');
do $$ declare e text; begin
  begin perform save_snippets('00000000-0000-0000-0000-00000000000a', null, null, null, null, '[]'); exception when others then e := sqlerrm; end;
  if e <> 'invalid' then raise exception 'FAIL: empty batch -> %', e; end if; e := null;
  begin perform save_snippets('00000000-0000-0000-0000-00000000000a', null, null, null, null, (select jsonb_agg(jsonb_build_object('code', 'code ' || i || repeat('x', 5))) from generate_series(1,21) i)); exception when others then e := sqlerrm; end;
  if e <> 'invalid' then raise exception 'FAIL: 21 items -> %', e; end if; e := null;
  begin perform save_snippets('00000000-0000-0000-0000-00000000000a', null, null, null, null, '{"a":1}'); exception when others then e := sqlerrm; end;
  if e <> 'invalid' then raise exception 'FAIL: non-array -> %', e; end if;
  raise notice 'ok   empty, >20 and non-array batches are rejected';
end $$;
select ok((save_snippets(:'A', null, null, null, null, '[{"title":"short","code":"x"},{"title":"ok","code":"valid code 1\nvalid code 2"}]')->>'saved')::int = 1, 'rows violating length rules are skipped, the rest are saved');
select save_snippets(:'A', 'javascript:alert(1)', null, null, null, '[{"code":"abc abc abc\ndef def"}]') as _ \gset
select ok((select source_url from code_snippets where code like 'abc abc abc%') is null, 'a non-http source URL is dropped, the snippet is still saved');
select ok(as_user(:'A', $q$insert into code_snippets(user_id, title, code) values (auth.uid(), 't', 'abcdef')$q$) like 'permission denied%', 'no direct INSERT from the REST API (caps cannot be bypassed)');

-- caps
update code_snippets set created_at = now() - interval '2 days';
do $$ declare i int; begin for i in 1..299 loop insert into code_snippets(user_id, title, code, created_at) values ('00000000-0000-0000-0000-00000000000b', 'bulk'||i, 'bulk code number ' || i, now() - interval '2 days'); end loop; end $$;
select ok((save_snippets(:'B', null, null, null, null, '[{"title":"n1","code":"new code one one"},{"title":"n2","code":"new code two two"}]')->>'saved')::int = 2, 'older rows do not count toward the daily cap');
do $$ declare i int; e text; begin
  for i in 1..298 loop insert into code_snippets(user_id, title, code) values ('00000000-0000-0000-0000-00000000000a', 'today'||i, 'today code number ' || i); end loop;     -- 298 today
  if (select (save_snippets('00000000-0000-0000-0000-00000000000a', null, null, null, null, '[{"code":"p1 p1 p1 p1"},{"code":"p2 p2 p2 p2"},{"code":"p3 p3 p3 p3"}]')->>'saved')::int) <> 2 then raise exception 'FAIL: only 2 of 3 fit under the cap'; end if;
  raise notice 'ok   partial headroom: saves what fits under 300/day, reports the rest as skipped';
  begin perform save_snippets('00000000-0000-0000-0000-00000000000a', null, null, null, null, '[{"code":"one more code\nplease"}]'); exception when others then e := sqlerrm; end;
  if e is distinct from 'daily_limit' then raise exception 'FAIL: daily cap -> %', e; end if;
  raise notice 'ok   300 per rolling day enforced';
end $$;
update code_snippets set created_at = now() - interval '3 days' where user_id = :'A';

-- RLS
select ok(as_user(:'A', $q$do $d$ begin if (select count(*) from code_snippets where user_id <> auth.uid()) > 0 then raise exception 'leak'; end if; end $d$$q$) = 'OK', 'RLS: A sees none of B''s snippets');
select ok(as_user(null, $q$select * from code_snippets$q$) like 'permission denied%', 'anon cannot read');
select ok(as_user(:'A', $q$update code_snippets set code = 'hacked code here' where user_id = auth.uid()$q$) like 'permission denied%', 'code column is immutable for users');
select as_user(:'A', $q$update code_snippets set title = 'renamed' where user_id = auth.uid() and title = 'Pool'$q$) as dbg \gset
select ok(:'dbg' = 'OK' and (select count(*) from code_snippets where title = 'renamed' and user_id = :'A') = 1, 'title is editable: ' || :'dbg');
select ok(as_user(:'A', $q$update code_snippets set title = 'stolen' where user_id <> auth.uid()$q$) = 'OK' and not exists (select 1 from code_snippets where title = 'stolen'), 'cannot edit another user''s rows');
select ok(as_user(:'A', $q$select save_snippets(auth.uid(), null, null, null, null, '[]')$q$) like 'permission denied%', 'save_snippets is service-role only');

-- search
select ok((select count(*) from code_snippets where user_id = :'B' and fts @@ websearch_to_tsquery('simple', 'bulk')) >= 299, 'full-text search finds code tokens');
select ok((select count(*) from code_snippets where user_id = :'A' and fts @@ websearch_to_tsquery('simple', 'select -sqlnope')) >= 1, 'websearch syntax with exclusion works');
select ok((select count(*) from code_snippets where fts @@ websearch_to_tsquery('simple', ')))((( :::')) = 0, 'odd input never errors');
select ok((select language from snippet_languages(:'A') order by n desc limit 1) is not null, 'language facets');

-- rate limiter
select ok((select bool_and(rate_hit(:'A', 'x', 3, 3600)) from generate_series(1,3)), 'rate_hit: first 3 allowed');
select ok(not rate_hit(:'A', 'x', 3, 3600), 'rate_hit: 4th denied');
select ok(rate_hit(:'B', 'x', 3, 3600) and rate_hit(:'A', 'y', 3, 3600), 'rate_hit: per user and per key');
select ok(as_user(:'A', $q$select rate_hit(auth.uid(), 'x', 1, 60)$q$) like 'permission denied%', 'rate_hit not callable by users');

-- cascades
delete from oneclist_items where user_id = :'A';
select ok((select count(*) from code_snippets where user_id = :'A' and item_id is not null) = 0 and (select count(*) from code_snippets where user_id = :'A') > 0, 'deleting a bookmark keeps the snippets (link nulled)');
delete from auth.users where id = :'B';
select ok((select count(*) from code_snippets where user_id = :'B') = 0, 'deleting the user deletes their snippets');
select 'ALL PASSED';

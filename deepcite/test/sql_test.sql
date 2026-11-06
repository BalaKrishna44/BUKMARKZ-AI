\set ON_ERROR_STOP on
create or replace function ok(c boolean, m text) returns void language plpgsql as $$ begin if not c then raise exception 'FAIL: %', m; end if; raise notice 'ok   %', m; end $$;
create or replace function as_user(u text, q text) returns text language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u,''), false); execute 'set local role ' || case when u is null then 'anon' else 'authenticated' end;
  begin execute q; reset role; perform set_config('request.jwt.claim.sub', '', false); return 'OK'; exception when others then reset role; perform set_config('request.jwt.claim.sub', '', false); return sqlerrm; end; end $$;
create or replace function err_of(q text) returns text language plpgsql as $$ begin execute q; return 'none'; exception when others then return sqlerrm; end $$;
grant execute on function ok(boolean,text), as_user(text,text), err_of(text) to public;
set client_min_messages = notice;
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
insert into auth.users values (:'A'),(:'B');
insert into oneclist_items(user_id, url_key) values (:'A', 'example.com/post'), (:'B', 'example.com/post');
select id as ia from oneclist_items where user_id = :'A' \gset

-- save + normalise + auto-link
select save_highlight(:'A', 'https://example.com/post?utm_source=x', 'example.com/post', 'A post', E'  The   quick\n brown fox  ', 'before', 'after', 'my note',
  '{"title":"A post","authors":["Ada Lovelace","ada lovelace","  ","Charles Babbage"],"published":"2024-05-03","container":"Example Blog","doi":"10.1234/abc.5"}') as r \gset
select ok((:'r'::jsonb->>'duplicate') = 'false', 'first save is new');
select ok((select quote from highlights where user_id = :'A') = 'The quick brown fox', 'whitespace in the quote is collapsed');
select ok((select item_id from highlights where user_id = :'A') = :'ia'::uuid, 'auto-linked to the user''s own bookmark of the page');
select ok((select authors from citation_meta where user_id = :'A') = array['Ada Lovelace','Charles Babbage'], 'authors cleaned, de-duplicated case-insensitively, blanks dropped');
select ok((select published from citation_meta where user_id = :'A') = '2024-05-03' and (select doi from citation_meta where user_id = :'A') = '10.1234/abc.5', 'date and DOI stored');

-- duplicates
select ok((save_highlight(:'A', 'https://example.com/post', 'example.com/post', 'A post', 'The quick   brown fox', null, null, null, null)->>'duplicate') = 'true', 'same passage again (different spacing) -> duplicate, not an error');
select ok((select count(*) from highlights where user_id = :'A') = 1, 'still one row');
select ok((save_highlight(:'B', 'https://example.com/post', 'example.com/post', 'A post', 'The quick brown fox', null, null, null, null)->>'duplicate') = 'false', 'another user can save the same passage');
select ok((select item_id from highlights where user_id = :'B') <> :'ia'::uuid, 'never links to another user''s bookmark');

-- validation
select ok(err_of($q$select save_highlight('00000000-0000-0000-0000-00000000000a','https://e.com/x','e.com/x',null,'ab',null,null,null,null)$q$) = 'invalid', 'quote under 3 chars rejected');
select ok(err_of($q$select save_highlight('00000000-0000-0000-0000-00000000000a','javascript:alert(1)','x',null,'valid quote',null,null,null,null)$q$) = 'invalid', 'non-http source rejected');
select ok(err_of($q$select save_highlight('00000000-0000-0000-0000-00000000000a','https://e.com/x','e.com/x',null,repeat('a',2001),null,null,null,null)$q$) = 'invalid', 'quote over 2000 chars rejected');
select ok(err_of($q$select save_highlight(null,'https://e.com/x','e.com/x',null,'valid quote',null,null,null,null)$q$) = 'not_authenticated', 'no user rejected');

-- metadata: automatic fills never overwrite what is there; bad values are dropped, not errors
select save_highlight(:'A', 'https://example.com/post', 'example.com/post', 'A post', 'second passage here', null, null, null,
  '{"title":"OTHER TITLE","authors":["Someone Else"],"published":"not-a-date","doi":"nope"}');
select ok((select title from citation_meta where user_id = :'A') = 'A post' and (select authors from citation_meta where user_id = :'A') = array['Ada Lovelace','Charles Babbage'], 'existing title/authors are kept');
select ok((select published from citation_meta where user_id = :'A') = '2024-05-03', 'an invalid date from the page does not replace a good one');

-- user edits win over later automatic fills
select ok((set_cite_meta(:'A', 'example.com/post', '{"title":"Fixed","authors":["Grace Hopper"],"published":"2023","container":"","doi":""}')->>'ok') = 'true', 'user can correct details');
select ok((select edited and doi is null and container is null and published = '2023' from citation_meta where user_id = :'A'), 'edit replaces values, clears empty fields, sets edited');
select save_highlight(:'A', 'https://example.com/post', 'example.com/post', 'A post', 'third passage here', null, null, null, '{"title":"Auto","authors":["Auto Author"],"doi":"10.1/zzzz"}');
select ok((select title = 'Fixed' and authors = array['Grace Hopper'] and doi is null from citation_meta where user_id = :'A'), 'later automatic fills never overwrite an edited row');
select ok(err_of($q$select set_cite_meta('00000000-0000-0000-0000-00000000000a','example.com/post','{"published":"23"}')$q$) = 'invalid_date', 'bad date rejected');
select ok(err_of($q$select set_cite_meta('00000000-0000-0000-0000-00000000000a','example.com/post','{"doi":"https://doi.org/10.1/x"}')$q$) = 'invalid_doi', 'bad DOI rejected');
select ok(err_of($q$select set_cite_meta('00000000-0000-0000-0000-00000000000a','no-highlights.com/x','{"title":"x"}')$q$) = 'not_found', 'cannot create details for a page with no highlights');

-- caps
do $$ declare e text; i int; begin
  for i in 1..197 loop perform save_highlight('00000000-0000-0000-0000-00000000000a', 'https://example.com/post', 'example.com/post', null, 'filler passage number ' || i, null, null, null, null); end loop;
  begin perform save_highlight('00000000-0000-0000-0000-00000000000a', 'https://example.com/post', 'example.com/post', null, 'one passage too many', null, null, null, null); exception when others then e := sqlerrm; end;
  if e <> 'page_limit' then raise exception 'FAIL: 201st highlight on a page -> %', coalesce(e, 'allowed'); end if;
  raise notice 'ok   200 highlights per page enforced';
  e := null;
  for i in 1..100 loop perform save_highlight('00000000-0000-0000-0000-00000000000a', 'https://example.com/p' || i, 'example.com/p' || i, null, 'bulk passage ' || i, null, null, null, null); end loop;
  begin perform save_highlight('00000000-0000-0000-0000-00000000000a', 'https://example.com/q', 'example.com/q', null, 'over the daily cap', null, null, null, null); exception when others then e := sqlerrm; end;
  if e <> 'daily_limit' then raise exception 'FAIL: 301st highlight in a day -> %', coalesce(e, 'allowed'); end if;
  raise notice 'ok   300 per day enforced';
end $$;
select ok((select count(*) from highlights where user_id = :'B') = 1, 'one user''s cap does not affect another');

-- RLS and grants
select ok(as_user(:'A', $q$select 1/(case when (select count(*) from highlights) > 0 and (select count(*) from highlights where user_id <> auth.uid()) = 0 then 1 else 0 end)$q$) = 'OK', 'a user sees only their own highlights');
select ok(as_user(:'B', $q$select 1/(case when (select count(*) from citation_meta) = 0 then 1 else 0 end)$q$) = 'OK', 'a user sees only their own citation details');
select ok(as_user(null, $q$select * from highlights$q$) like 'permission denied%', 'anonymous cannot read');
select ok(as_user(:'A', $q$insert into highlights(user_id, source_url, url_key, quote) values (auth.uid(), 'https://e.com', 'e.com', 'direct insert')$q$) like 'permission denied%', 'no direct inserts (caps cannot be bypassed)');
select ok(as_user(:'A', $q$update highlights set quote = 'tampered'$q$) like 'permission denied%', 'the quote itself is immutable');
select ok(as_user(:'A', $q$update highlights set note = 'edited note' where id = (select id from highlights limit 1)$q$) = 'OK', 'note is editable');
select ok(as_user(:'A', $q$select save_highlight(auth.uid(), 'https://e.com', 'e.com', null, 'rpc from client', null, null, null, null)$q$) like 'permission denied%', 'save_highlight is not callable by clients');
select ok(as_user(:'A', $q$insert into citation_meta(user_id, url_key) values (auth.uid(), 'x')$q$) like 'permission denied%', 'citation details cannot be written directly');
select as_user(:'B', $q$delete from highlights where user_id <> auth.uid()$q$) as d0 \gset
select ok(:'d0' = 'OK' and (select count(*) from highlights where user_id = :'A') > 0, 'cannot delete someone else''s highlights');
select as_user(:'B', $q$delete from highlights$q$) as d \gset
select ok(:'d' = 'OK' and (select count(*) from highlights where user_id = :'B') = 0, 'can delete own');

-- deleting the bookmark keeps the highlight; deleting the user removes everything
delete from oneclist_items where id = :'ia';
select ok((select count(*) from highlights where user_id = :'A' and item_id is null) > 0 and (select count(*) from highlights where user_id = :'A' and item_id is not null) = 0, 'deleting the bookmark keeps its highlights');
delete from auth.users where id = :'A';
select ok((select count(*) from highlights where user_id = :'A') = 0 and (select count(*) from citation_meta where user_id = :'A') = 0, 'deleting the user removes highlights and details');

-- full-text search
insert into auth.users values ('00000000-0000-0000-0000-00000000000c');
select save_highlight('00000000-0000-0000-0000-00000000000c', 'https://x.org/a', 'x.org/a', 'Vector indexes', 'HNSW indexes trade build time for recall', null, null, 'revisit', null);
select ok((select count(*) from highlights where fts @@ websearch_to_tsquery('english', 'indexing recall')) = 1, 'quote is searchable with stemming');
select ok((select count(*) from highlights where fts @@ websearch_to_tsquery('english', 'revisit')) = 1, 'note is searchable');

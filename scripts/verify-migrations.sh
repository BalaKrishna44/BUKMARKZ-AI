#!/bin/sh
# usage: run.sh file-list.txt   (applies each file in order to a fresh PG16 with stubs; prints first error per file)
B=/usr/lib/postgresql/16/bin; D=$(mktemp -d); H=$D/sock; mkdir -p $H; P=5496; R=/tmp/gh/bukmarkz
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t
PS="$B/psql -h $H -p $P -d t -q"
$PS -f $R/qa-suite/supabase/tests/_sandbox/setup.sql >/dev/null
cat > $D/stub.sql <<'SQL'
create schema cron; create table cron.job(jobid bigserial, jobname text);
create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
create function cron.unschedule(text) returns boolean language sql as 'select true';
create schema extensions; create schema net; create schema vault;
create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as 'select 1::bigint';
create table vault.decrypted_secrets(name text, decrypted_secret text);
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as 'select (string_to_array(name, ''/''))[1:cardinality(string_to_array(name, ''/''))-1]';
create publication supabase_realtime;
SQL
$PS -v ON_ERROR_STOP=0 -f $D/stub.sql 2>&1 | grep ERROR
fail=0
while read f; do
  case "$f" in \#*|"") continue;; esac
  sed -E -e 's/create extension if not exists (vector|pg_cron|pg_net)[^;]*;//I' -e 's/extensions\.vector/real[]/g' -e 's/\bvector\([0-9]+\)/real[]/g' -e 's/::vector\b/::real[]/g' -e 's/ vector\b([^_(])/ real[]\1/g' -e 's/^(.*(ivfflat|hnsw).*)$/-- \1/I' "$R/$f" > $D/cur.sql
  out=$($PS -v ON_ERROR_STOP=1 -c "set check_function_bodies=off" -f $D/cur.sql 2>&1 >/dev/null | grep -m2 -E "ERROR|FATAL")
  if [ -n "$out" ]; then echo "FAIL $f"; echo "$out" | sed 's/^/    /'; fail=1; fi
done < "$1"
$B/pg_ctl -D $D/data stop >/dev/null; rm -rf $D; exit $fail

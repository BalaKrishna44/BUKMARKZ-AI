#!/bin/sh
# Throw-away PG16 + Supabase stand-ins + pgvector stub: proves 024 closes the hole. Needs PG16 binaries.
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5497
R=$T/../..; S=$R/qa-suite/supabase/tests/_sandbox
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t; Q="$B/psql -h $H -p $P -d t -q -v ON_ERROR_STOP=1"
# 001 minus the pieces the stub can't do (real pgvector extension, HNSW index, vector(1536) typmod)
sed -e '/create extension/d' -e '/using hnsw/d' -e 's/vector(1536)/vector/g' $R/ai-engine/sql/001_ai_features.sql > $D/001.sql
$Q -f $S/setup.sql -f $R/resurface/test/vector_stub.sql -f $R/share_kit/supabase/bookmarks.sql -f $D/001.sql >/dev/null 2>$D/e || { cat $D/e; exit 2; }
$Q -f $T/../sql/024_lock_search_index.sql -f $T/../sql/024_lock_search_index.sql >/dev/null 2>$D/e || { echo "024 failed:"; cat $D/e; exit 2; }   # twice: re-runnable
$B/psql -h $H -p $P -d t -q -f $T/rls_024.test.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL" | sed 's/^psql:[^ ]* [0-9]*: //' | tee $D/out.txt
$B/pg_ctl -D $D/data stop >/dev/null; ! grep -q 'ERROR\|FAIL' $D/out.txt; rc=$?; rm -rf $D; exit $rc

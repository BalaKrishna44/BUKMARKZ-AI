#!/bin/sh
# Throw-away PostgreSQL 16 + Supabase stand-ins (qa-suite/_sandbox) + 030 migration, then the SQL tests. Prints ok/FAIL lines; exit 1 on any FAIL/ERROR.
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5498
S=${REPO:-$T/../..}/qa-suite/supabase/tests/_sandbox
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t
$B/psql -h $H -p $P -d t -q -v ON_ERROR_STOP=1 -f $S/setup.sql -f $S/base.sql -f $T/../sql/031_avatars.sql >/dev/null 2>$D/mig.err || { echo "migration failed:"; cat $D/mig.err; $B/pg_ctl -D $D/data stop >/dev/null; exit 2; }
$B/psql -h $H -p $P -d t -q -f $T/avatars.test.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL" | sed 's/^psql:[^ ]* [0-9]*: //' | tee $D/out.txt
$B/pg_ctl -D $D/data stop >/dev/null
! grep -q 'ERROR\|FAIL' $D/out.txt; rc=$?; rm -rf $D; exit $rc

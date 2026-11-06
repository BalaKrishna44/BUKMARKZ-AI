#!/bin/sh
# Needs PostgreSQL 16 binaries; run as a user allowed to start a server (e.g. postgres).
# Applies: Supabase stand-ins, items table (+RLS) as in 001/004, stacks 010 + 012, then 017, twice (must be re-runnable), then the tests.
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5498
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t
Q="$B/psql -h $H -p $P -d t -q"
$Q -v ON_ERROR_STOP=1 -f $T/fixtures/setup.sql -f $T/fixtures/base.sql -f $T/fixtures/010_stacks.sql -f $T/fixtures/012_stack_social.sql -f $T/../sql/017_team_vaults.sql >/dev/null 2>$D/mig.err || { echo "migration failed"; cat $D/mig.err; }
$Q -v ON_ERROR_STOP=1 -f $T/../sql/017_team_vaults.sql >/dev/null 2>$D/mig2.err || { echo "017 is not re-runnable"; cat $D/mig2.err; }
$Q -f $T/sql_test.sql 2>&1 >/dev/null | sed 's/psql:[^ ]* //' | grep -v '^$'
$B/pg_ctl -D $D/data stop >/dev/null; rm -rf $D

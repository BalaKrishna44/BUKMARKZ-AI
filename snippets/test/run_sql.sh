#!/bin/sh
# Needs PostgreSQL 16 binaries; run as a user allowed to start a server (e.g. postgres).
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd)
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p 5494 -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p 5494 t
$B/psql -h $H -p 5494 -d t -q -v ON_ERROR_STOP=1 -f $T/sql_setup.sql -f $T/../sql/014_snippets.sql >/dev/null 2>$D/mig.err || { echo "migration failed"; cat $D/mig.err; }
$B/psql -h $H -p 5494 -d t -q -f $T/sql_test.sql 2>&1 >/dev/null | sed 's/psql:[^ ]* //' | grep -v '^$'
$B/pg_ctl -D $D/data stop >/dev/null; rm -rf $D

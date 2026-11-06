#!/bin/sh
# PostgreSQL 16, run as a user allowed to start a server (e.g. postgres). Applies 028 twice (re-runnable) and runs sessions_test.sql.
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5496
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t
cd $T && $B/psql -h $H -p $P -d t -q -f sessions_test.sql 2>&1 | sed 's/psql:[^ ]* //' | grep -v '^$\|^ *_\|^---\|row)\|0000'
$B/pg_ctl -D $D/data stop >/dev/null; rm -rf $D

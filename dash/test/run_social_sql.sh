#!/bin/sh
# Usage: run_social_sql.sh   (needs PostgreSQL 16 binaries; run as a user that may start a server, e.g. postgres)
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(dirname "$0")
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p 5497 -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p 5497 t
$B/psql -h $H -p 5497 -d t -q -v ON_ERROR_STOP=1 -f $T/social_setup.sql -f $T/../sql/010_stacks.sql -f $T/../sql/012_stack_social.sql >/dev/null 2>&1 || { echo "migration failed"; }
$B/psql -h $H -p 5497 -d t -q -f $T/social_test.sql 2>&1 >/dev/null | sed 's/psql:[^ ]* //' | grep -v '^$'
$B/pg_ctl -D $D/data stop >/dev/null; rm -rf $D

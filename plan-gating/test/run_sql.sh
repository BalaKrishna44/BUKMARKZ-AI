#!/bin/sh
# Needs PostgreSQL 16 binaries; run as a user allowed to start a server (e.g. postgres). Applies 013 (fixture), then 016, then the tests,
# then fires 30 PARALLEL callers at one limit to prove the gate is atomic.
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5496
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H -c max_connections=100" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t
Q="$B/psql -h $H -p $P -d t -q"
$Q -v ON_ERROR_STOP=1 -f $T/sql_setup.sql -f $T/fixtures/013_mcp.sql -f $T/pre_016.sql -f $T/../sql/016_plan_gating.sql >/dev/null 2>$D/mig.err || { echo "migration failed"; cat $D/mig.err; }
$Q -v ON_ERROR_STOP=1 -f $T/../sql/016_plan_gating.sql >/dev/null 2>$D/mig2.err || { echo "migration is not re-runnable"; cat $D/mig2.err; }
$Q -f $T/sql_test.sql 2>&1 >/dev/null | sed 's/psql:[^ ]* //' | grep -v '^$'
# --- concurrency: 30 parallel 'ask' calls against a limit of 20 must allow exactly 20
$Q -c "insert into auth.users values ('00000000-0000-0000-0000-0000000000c1')" >/dev/null
LIM='{"free":{"ask":20,"mcp":50,"index":300,"snapshot":0},"pro":{"ask":1000,"mcp":10000,"index":25000,"snapshot":500},"team":{"ask":1500,"mcp":10000,"index":25000,"snapshot":1000}}'
for i in $(seq 1 30); do ( $Q -At -c "select gate_consume('00000000-0000-0000-0000-0000000000c1','ask',1,'$LIM'::jsonb)->>'allowed'" >> $D/par.txt ) & done; wait
ALLOWED=$(grep -c '^true$' $D/par.txt); DENIED=$(grep -c '^false$' $D/par.txt)
USED=$($Q -At -c "select ask_count from monthly_usage_meters where user_id='00000000-0000-0000-0000-0000000000c1'")
[ "$ALLOWED" = 20 ] && [ "$DENIED" = 10 ] && [ "$USED" = 20 ] && echo "NOTICE:  ok   30 parallel callers, limit 20: exactly 20 allowed, 10 denied, counter = 20" || echo "FAIL: parallel ask allowed=$ALLOWED denied=$DENIED counter=$USED"
# 10 parallel importers of 100 items each against a 300 total (partial grants): total must be exactly 300
$Q -c "insert into auth.users values ('00000000-0000-0000-0000-0000000000c2')" >/dev/null
for i in $(seq 1 10); do ( $Q -At -c "select (gate_consume('00000000-0000-0000-0000-0000000000c2','index',100,'$LIM'::jsonb,true)->>'granted')::int" >> $D/idx.txt ) & done; wait
SUM=$(awk '{s+=$1} END {print s+0}' $D/idx.txt); TOT=$($Q -At -c "select indexed_total from ai_index_state where user_id='00000000-0000-0000-0000-0000000000c2'")
[ "$SUM" = 300 ] && [ "$TOT" = 300 ] && echo "NOTICE:  ok   10 parallel importers (100 each, partial): exactly 300 granted in total" || echo "FAIL: parallel index granted=$SUM total=$TOT"
$B/pg_ctl -D $D/data stop >/dev/null; rm -rf $D

#!/bin/sh
# Needs PostgreSQL 16 binaries; run as a user allowed to start a server (e.g. postgres).
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5499
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H -c max_connections=100" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t
Q="$B/psql -h $H -p $P -d t -q"
$Q -v ON_ERROR_STOP=1 -f $T/setup.sql -f $T/base.sql -f $T/../sql/018_price_alerts.sql >/dev/null 2>$D/mig.err || { echo "migration failed"; cat $D/mig.err; }
$Q -v ON_ERROR_STOP=1 -f $T/../sql/018_price_alerts.sql >/dev/null 2>$D/mig2.err || { echo "018 is not re-runnable"; cat $D/mig2.err; }
$Q -f $T/sql_test.sql 2>&1 >/dev/null | sed 's/psql:[^ ]* //' | grep -v '^$'
# concurrency: 20 parallel observations that all qualify must claim the (single) watch exactly once
$Q -c "insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000c1','c@x.test')" >/dev/null
$Q -c "insert into oneclist_items(id,user_id,url,url_key,title) values ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','https://www.amazon.in/dp/B0PARALLEL','x','Par')" >/dev/null
$Q -c "insert into product_watches(user_id,item_id,product_key,target_price,currency,min_drop_pct) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','amazon.in:B0PARALLEL',100,'INR',0)" >/dev/null
for i in $(seq 1 20); do ( $Q -At -c "select count(*) from price_claim_alerts('amazon.in:B0PARALLEL', 90, 'INR', null, '00000000-0000-0000-0000-0000000000c1')" >> $D/par.txt ) & done; wait
N=$(awk '{s+=$1} END {print s+0}' $D/par.txt)
[ "$N" = 1 ] && echo "NOTICE:  ok   20 parallel qualifying observations: the watch is claimed exactly once" || echo "FAIL: parallel claims = $N"
$B/pg_ctl -D $D/data stop >/dev/null; rm -rf $D

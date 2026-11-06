#!/bin/sh
# Throw-away PostgreSQL 16 with Supabase stand-ins (from qa-suite/_sandbox) + your migrations. Needs PG16 binaries and rights to start a server.
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5498
R=${REPO:-$T/../..}; S=$R/qa-suite/supabase/tests/_sandbox
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t; Q="$B/psql -h $H -p $P -d t -q -v ON_ERROR_STOP=1"
F=""; for f in $S/setup.sql $S/base.sql $S/010_stacks.sql $S/012_stack_social.sql $T/fixtures/plan_stub.sql $T/../sql/020_onboarding.sql $T/../sql/021_referrals.sql $T/../sql/022_digest.sql $T/fixtures/resurface_cols.sql $T/../sql/025_digest_v2.sql $T/../sql/029_friday.sql; do F="$F -f $f"; done
$Q $F >/dev/null 2>$D/mig.err || { echo "migration failed:"; cat $D/mig.err; $B/pg_ctl -D $D/data stop >/dev/null; exit 2; }
$B/psql -h $H -p $P -d t -q -v ON_ERROR_STOP=1 -f $T/growth.test.sql -f $T/friday.test.sql 2>&1 | grep -E "^psql:|NOTICE|ERROR|FAIL" | sed 's/^psql:[^ ]* [0-9]*: //' | tee $D/out.txt
# seed script: run twice (must be re-runnable) and check the result
$Q -c "delete from stacks; delete from creator_profiles; insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000ff') on conflict do nothing" >/dev/null
for k in 1 2; do $Q -v owner="'00000000-0000-0000-0000-0000000000ff'" -f $T/../scripts/seed_starter_stacks.sql >/dev/null 2>$D/seed.err || { echo "FAIL: seed script: $(cat $D/seed.err)" | tee -a $D/out.txt; }; done
N=$($Q -t -A -c "select (select count(*) from stacks where is_starter) || '/' || (select count(*) from stack_items i join stacks s on s.id=i.stack_id where s.is_starter)")
[ "$N" = "3/9" ] && echo "NOTICE:  ok - seed script: 3 starter stacks, 9 links, re-runnable" | tee -a $D/out.txt || echo "FAIL: seed counts $N" | tee -a $D/out.txt
$B/pg_ctl -D $D/data stop >/dev/null
! grep -q 'ERROR\|FAIL' $D/out.txt; rc=$?; rm -rf $D; exit $rc

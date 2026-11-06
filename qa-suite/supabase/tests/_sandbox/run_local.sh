#!/bin/sh
# Runs ../rls.test.sql on a throw-away PostgreSQL 16 with Supabase stand-ins, the pgTAP shim, and your migrations.
#   MIG="path/importexport/sql/001.sql path/dash/sql/010_stacks.sql ..." sh run_local.sh     (order matters; default = this repo's layout)
# Needs PG16 binaries and a user allowed to start a server (e.g. `su postgres -c "sh run_local.sh"`).
B=${PGBIN:-/usr/lib/postgresql/16/bin}; D=$(mktemp -d); H=$D/sock; mkdir -p $H; T=$(cd "$(dirname "$0")" && pwd); P=5497
R=${REPO:-$T/../../../..}
MIG=${MIG:-"$T/010_stacks.sql $T/012_stack_social.sql $R/team-vaults/sql/017_team_vaults.sql"}
$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o "-p $P -k $H" -l $D/log start >/dev/null && sleep 2
$B/createdb -h $H -p $P t
Q="$B/psql -h $H -p $P -d t -q -v ON_ERROR_STOP=1"
F=""; for f in $T/setup.sql $T/base.sql $MIG; do F="$F -f $f"; done
$Q $F >/dev/null 2>$D/mig.err || { echo "migration failed:"; cat $D/mig.err; $B/pg_ctl -D $D/data stop >/dev/null; exit 2; }
$Q -f $T/pgtap_shim.sql >/dev/null
$B/psql -h $H -p $P -d t -q -t -A -v ON_ERROR_STOP=0 -f $T/../rls.test.sql 2>&1 | grep -v '^BEGIN$\|^ROLLBACK$\|^$\|^SET$\|^CREATE\|^INSERT\|^UPDATE\|^DROP\|^RESET' | tee $D/out.txt
$B/pg_ctl -D $D/data stop >/dev/null
! grep -q '^not ok\|Looks like\|ERROR' $D/out.txt; rc=$?; rm -rf $D; exit $rc

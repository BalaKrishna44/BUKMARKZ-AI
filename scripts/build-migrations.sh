#!/bin/sh
# Rebuilds supabase/migrations/ (Supabase CLI format) from supabase/migration-order.txt. The kit folders stay the source of truth; edit a kit, then re-run this.
# Usage (repo root): sh scripts/build-migrations.sh      then:  supabase db push
set -e
cd "$(dirname "$0")/.."
rm -f supabase/migrations/*.sql
i=0
grep -v '^#\|^$' supabase/migration-order.txt | while read -r f; do
  i=$((i+1)); n=$(printf '%06d' $i)
  cp "$f" "supabase/migrations/20260101${n}_$(basename "$f")"
done
echo "wrote $(ls supabase/migrations | wc -l) migrations"

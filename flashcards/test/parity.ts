// Dev check: the TypeScript scheduler must agree with SQL review_card() step by step.
//   PGHOST=/tmp PGPORT=5497 PGUSER=postgres tsx test/parity.ts   (against a database with sql/010 applied)
import { execFileSync } from 'node:child_process';
import { schedule, type Rating, type Sched } from '../lib/sm2';
const psql = (sql: string) => execFileSync('psql', ['-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', maxBuffer: 1 << 26 });
const U = '00000000-0000-0000-0000-00000000000a';
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
psql(`insert into oneclist_items(id, user_id) values ('20000000-0000-0000-0000-000000000001','${U}') on conflict do nothing`);
let steps = 0, bad = 0;
for (let n = 0; n < 300; n++) {
  const id = `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  psql(`insert into flashcards(id,user_id,item_id,question,answer) values ('${id}','${U}','20000000-0000-0000-0000-000000000001','Question number ${n} for the parity test?','a')`);
  let c: Sched = { state: 'new', ease: 2.5, interval_days: 0, reps: 0, lapses: 0 };
  const stmts: string[] = [], expected: Sched[] = [];
  for (let k = 0; k < 14 && c.state !== 'suspended'; k++) {
    const r = Math.floor(rnd() * (rnd() < 0.7 ? 4 : 2)) as Rating;     // mostly all ratings, sometimes only again/hard to stress lapses
    const nx = schedule(c, r); c = { state: nx.state, ease: nx.ease, interval_days: nx.interval_days, reps: nx.reps, lapses: nx.lapses };
    expected.push(c); stmts.push(`select review_card('${U}','${id}',${r})`);
  }
  const got = psql(stmts.join(';\n') + ';').trim().split('\n').map((l) => JSON.parse(l));
  got.forEach((g, i) => { steps++; const e = expected[i]; if (g.state !== e.state || +g.ease !== e.ease || g.interval_days !== e.interval_days || g.reps !== e.reps || g.lapses !== e.lapses) { bad++; if (bad < 4) console.error('MISMATCH', n, i, g, e); } });
}
console.log(`${steps} review steps compared, ${bad} mismatches`); process.exit(bad ? 1 : 0);

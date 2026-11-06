import { tagColleague, mapDbError, type TagDeps, type CreateRow } from '../lib/shares/tag';
import { buildInviteEmail, displayName, hashInviteToken, INVITE_TOKEN_RE, newInviteToken, normalizeEmail } from '../lib/shares/invite';

let passed = 0, failed = 0;
const ok = (c: unknown, m: string) => { if (c) { passed++; console.log('ok   ' + m); } else { failed++; console.log('FAIL ' + m); } };
const ITEM = '11111111-1111-4111-8111-111111111111';
const ROW: CreateRow = { share_id: 's1', org_id: 'o1', org_name: 'Acme', outcome: 'created', send_count: 1, moved: true };
interface Log { created: any[]; sent: any[]; unsent: any[] }
function mk(over: Partial<TagDeps> = {}, row: Partial<CreateRow> | { error: string } = {}) {
  const log: Log = { created: [], sent: [], unsent: [] };
  const deps: TagDeps = {
    user: { id: 'u1', email: 'sarah@acme.test', emailConfirmed: true, name: 'Sarah' },
    siteUrl: 'https://bukmarkz.com/',
    async createShare(a) { log.created.push(a); return 'error' in row ? { error: row.error } : { row: { ...ROW, ...row } }; },
    async unsend(a) { log.unsent.push(a); },
    async item() { return { title: 'Connection pooling <b>guide</b>', url: 'https://db.example/pool?x=1' }; },
    async send(m) { log.sent.push(m); return true; },
    ...over,
  };
  return { deps, log };
}
const run = (d: TagDeps, o: Record<string, unknown> = {}) => tagColleague(d, { itemId: ITEM, email: 'Colleague@Example.com ', ...o });

(async () => {
  // happy path + the required wording
  { const { deps, log } = mk(); const r = await run(deps);
    ok(r.ok, 'happy path');
    ok(log.sent[0].subject === 'Sarah invited you to view a research stack on Bukmarkz', 'subject is exactly "Sarah invited you to view a research stack on Bukmarkz"');
    ok(log.sent[0].to === 'colleague@example.com' && log.created[0].email === 'colleague@example.com', 'email normalised once, used for both');
    const url = /https:\/\/bukmarkz\.com\/invite\/team\/([A-Za-z0-9_-]{43})/.exec(log.sent[0].text);
    ok(!!url && INVITE_TOKEN_RE.test(url[1]), 'link is /invite/team/<43-char secret> on our own site');
    ok(!!url && log.created[0].tokenHash === hashInviteToken(url[1]) && !JSON.stringify(log.created).includes(url[1]), 'only the hash reaches the database');
    ok(log.sent[0].idempotencyKey === 'team-share-s1-1', 'idempotency key per share + send');
    ok(!/<b>/.test(log.sent[0].html) && /&lt;b&gt;/.test(log.sent[0].html), 'item title is HTML-escaped in the email'); }
  // identity & validation
  { const { deps, log } = mk({ user: null }); ok((await run(deps)).ok === false && log.created.length === 0, 'signed out: nothing created'); }
  { const { deps, log } = mk({ user: { id: 'u1', email: 'a@b.co', emailConfirmed: false, name: 'A' } }); const r = await run(deps);
    ok(!r.ok && r.error === 'forbidden' && log.created.length === 0 && log.sent.length === 0, 'unverified inviter cannot send mail'); }
  for (const bad of ['', 'nope', 'a@b', 'a b@c.co', 'a@@c.co', 'a@c..co', 'a@c.co, b@c.co', '<x@y.co>', 'x'.repeat(250) + '@a.co', 12 as any, null]) {
    const { deps, log } = mk(); const r = await run(deps, { email: bad });
    ok(!r.ok && r.error === 'invalid_email' && log.created.length === 0, 'rejects email ' + JSON.stringify(String(bad).slice(0, 20)));
  }
  for (const bad of ['', 'abc', "1' or 1=1", ITEM + 'x', undefined]) { const { deps } = mk(); const r = await run(deps, { itemId: bad }); ok(!r.ok && r.error === 'invalid_item', 'rejects item id ' + JSON.stringify(bad)); }
  { const { deps } = mk(); const r = await run(deps, { orgId: 'nope' }); ok(!r.ok && r.error === 'invalid_item', 'rejects malformed workspace id'); }
  { const { deps, log } = mk(); await run(deps, { orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }); ok(log.created[0].org === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'workspace id passed to the database (which re-checks membership)'); }
  { const { deps, log } = mk(); await run(deps, { actor: 'evil', user_id: 'evil' } as any); ok(log.created[0].actor === 'u1', 'actor is always the session user'); }
  // uniform replies
  for (const o of ['member', 'duplicate'] as const) {
    const { deps, log } = mk({}, { outcome: o, share_id: o === 'member' ? null : 's9' }); const r = await run(deps);
    ok(r.ok && log.sent.length === 0, `${o}: same success reply, no email`); }
  { const { deps, log } = mk({}, { outcome: 'resent', send_count: 3, moved: false }); await run(deps); ok(log.sent[0].idempotencyKey === 'team-share-s1-3', 'resend uses a fresh idempotency key'); }
  // failures roll back
  { const { deps, log } = mk({ send: async () => false }); const r = await run(deps);
    ok(!r.ok && r.error === 'email_failed' && log.unsent.length === 1 && log.unsent[0].wasNew === true && log.unsent[0].moved === true, 'send failure: share undone, item moved back'); }
  { const { deps, log } = mk({ send: async () => { throw new Error('network'); } }, { outcome: 'resent', moved: false }); const r = await run(deps);
    ok(!r.ok && r.error === 'email_failed' && log.unsent[0].wasNew === false, 'send throws: handled, resend rolled back softly'); }
  { const { deps } = mk({ unsend: async () => { throw new Error('db down'); }, send: async () => false }); const r = await run(deps); ok(!r.ok && r.error === 'email_failed', 'rollback failure does not crash'); }
  // db error mapping
  const m: [string, string][] = [['item_not_found P0002', 'not_found'], ['private_item_cannot_be_shared 23514', 'private'], ['org_required 22023', 'choose_workspace'], ['forbidden 42501', 'forbidden'],
    ['item_in_other_workspace', 'forbidden'], ['seat_limit_reached', 'seat_limit'], ['rate_limited 54000', 'rate_limited'], ['boom', 'failed']];
  for (const [msg, want] of m) ok(mapDbError(msg) === want, `db "${msg}" -> ${want}`);
  { const { deps, log } = mk({}, { error: 'seat_limit_reached 23514' }); const r = await run(deps); ok(!r.ok && r.error === 'seat_limit' && log.sent.length === 0, 'db refusal sends nothing'); }

  // helpers
  ok(normalizeEmail('A+tag@Sub.Example.co') === 'a+tag@sub.example.co', 'plus-addressing kept, lower-cased');
  ok(newInviteToken() !== newInviteToken() && INVITE_TOKEN_RE.test(newInviteToken()), 'tokens are random 256-bit base64url');
  ok(/^[0-9a-f]{64}$/.test(hashInviteToken('x')), 'hash is sha256 hex');
  ok(displayName({ full_name: 'Sarah Chen' }, 'x@y.co') === 'Sarah Chen', 'display name from profile');
  ok(displayName({ full_name: 'Click https://evil.test/now!!' }, 'sarah@acme.test') === 'Click httpseviltestnow', 'link-ish characters stripped from the display name');
  ok(displayName({ full_name: '12345 <script>' }, 'sarah@acme.test') === 'script', 'digits and brackets stripped');
  ok(displayName({ full_name: '!!!' }, 'sarah.chen@acme.test') === 'sarah.chen', 'falls back to the email local part');
  ok(displayName(null, null) === 'A colleague', 'last-resort name');
  ok(displayName({ full_name: 'A'.repeat(200) }, 'x@y.co').length === 40, 'name capped at 40');
  { const e = buildInviteEmail({ inviterName: 'Sarah\r\nBcc: x@y.co', inviterEmail: 'sarah@acme.test', workspace: 'Acme "<i>"', itemTitle: '', itemHost: 'db.example', acceptUrl: 'https://bukmarkz.com/invite/team/t' });
    ok(!/[\r\n]/.test(e.subject), 'no line breaks can reach the subject'); ok(!/<i>/.test(e.html), 'workspace name escaped'); ok(e.text.includes('Ignore this email'), 'says what to do if unexpected'); }
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();

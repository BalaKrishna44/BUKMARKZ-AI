/** Optional staging-only helpers (service-role). Never point SUPABASE_URL at production. Active only with E2E_SEED=1. */
export const seedEnabled = () => process.env.E2E_SEED === '1' && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

async function admin() {
  const url = process.env.SUPABASE_URL!;
  if (/bukmarkz-prod|\/\/db\.bukmarkz\.com/i.test(url)) throw new Error('Refusing to run E2E seeding against what looks like production.');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
async function userId(db: Awaited<ReturnType<typeof admin>>) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const u = data.users.find((x) => x.email?.toLowerCase() === process.env.E2E_EMAIL?.toLowerCase());
  if (!u) throw new Error('E2E user not found');
  return u.id;
}

export const SEED_LINKS = [
  { url: 'https://github.com/pgvector/pgvector', title: 'pgvector: vector similarity search for Postgres', summary: 'HNSW and IVFFlat indexes for approximate nearest neighbour search in Postgres.', tags: ['e2e-seed', 'vectors'] },
  { url: 'https://supabase.com/docs/guides/database/postgres/row-level-security', title: 'Row Level Security | Supabase Docs', summary: 'Policies that decide which rows each role can read or write.', tags: ['e2e-seed', 'security'] },
  { url: 'https://www.postgresql.org/docs/current/indexes-types.html', title: 'PostgreSQL: Index Types', summary: 'B-tree, Hash, GiST, SP-GiST, GIN and BRIN index types.', tags: ['e2e-seed', 'database'] },
];

/** Idempotent: inserts the seed links for the E2E account (ai_status 'pending' so the normal enrichment worker embeds them). */
export async function seedVault() {
  const db = await admin(); const uid = await userId(db);
  const rows = SEED_LINKS.map((l) => ({ user_id: uid, url: l.url, url_key: l.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, ''), title: l.title, summary: l.summary, tags: l.tags, source: 'e2e', status: 'bookmark', ai_status: 'pending' }));
  const { error } = await db.from('oneclist_items').upsert(rows, { onConflict: 'user_id,url_key' });
  if (error) throw error;
}
/** Removes everything the E2E account created: links tagged e2e-*, the probe link, remixed stacks. */
export async function cleanVault() {
  const db = await admin(); const uid = await userId(db);
  await db.from('oneclist_items').delete().eq('user_id', uid).or('source.eq.e2e,url.like.%e2e-probe%');
  await db.from('stacks').delete().eq('user_id', uid);
}

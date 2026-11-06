import { admin, json, requireUser } from '@/lib/server';
import { generateOrgToken } from '@/lib/mcp/org/auth';

/**
 * Workspace token management (admins and owners only; the database enforces it, this route only translates errors).
 *   GET     list tokens (never the secret)      POST {name}  create: the token is shown ONCE      DELETE ?id=<token id>  revoke
 * Uses the signed-in user's session for identity and the service role for the write, so the actor is always the verified user, never a body field.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NS = { 'cache-control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com').replace(/\/$/, '');
const sameOrigin = (req: Request) => { const o = req.headers.get('origin'); return !o || o === SITE || o === new URL(req.url).origin; };

type Ctx = { params: Promise<{ orgId: string }> };
async function actor(req: Request, ctx: Ctx) {
  const user = await requireUser(req);
  const { orgId } = await ctx.params;
  if (!user) return { error: json({ error: 'unauthorized' }, 401, NS) } as const;
  if (!UUID.test(orgId)) return { error: json({ error: 'not_found' }, 404, NS) } as const;
  return { user, orgId } as const;
}
const fromDbError = (message: string) =>
  /forbidden/.test(message) ? json({ error: 'forbidden' }, 403, NS)
  : /too_many_tokens/.test(message) ? json({ error: 'too_many_tokens', message: 'A workspace can have at most 10 active tokens. Revoke one first.' }, 409, NS)
  : json({ error: 'internal' }, 500, NS);

export async function GET(req: Request, ctx: Ctx) {
  const a = await actor(req, ctx); if ('error' in a) return a.error;
  const { data: role } = await admin.rpc('org_role_of', { p_org: a.orgId, p_user: a.user.id });
  if (role !== 'owner' && role !== 'admin') return json({ error: 'forbidden' }, 403, NS);
  const { data, error } = await admin.from('org_mcp_tokens').select('id,name,prefix,scopes,created_by,created_at,last_used_at,expires_at,revoked_at').eq('org_id', a.orgId).order('created_at', { ascending: false }).limit(50);
  if (error) return json({ error: 'internal' }, 500, NS);
  return json({ tokens: data ?? [] }, 200, NS);
}

export async function POST(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const a = await actor(req, ctx); if ('error' in a) return a.error;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return json({ error: 'invalid_name' }, 400, NS);
  const t = generateOrgToken();
  const { data, error } = await admin.rpc('org_issue_token', { p_actor: a.user.id, p_org: a.orgId, p_name: name, p_hash: t.hash, p_prefix: t.prefix, p_scopes: ['read'], p_expires_at: null });
  if (error) return fromDbError(error.message);
  return json({ id: data, name, prefix: t.prefix, token: t.token, note: 'Copy this token now: it is shown only once.' }, 201, NS);
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const a = await actor(req, ctx); if ('error' in a) return a.error;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return json({ error: 'invalid_id' }, 400, NS);
  const { data, error } = await admin.rpc('org_revoke_token', { p_actor: a.user.id, p_org: a.orgId, p_token: id });
  if (error) return fromDbError(error.message);
  return data ? json({ ok: true }, 200, NS) : json({ error: 'not_found' }, 404, NS);
}

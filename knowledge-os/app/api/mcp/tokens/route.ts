import { admin, json, requireUser } from '@/lib/server';
import { TIERS, SITE, generateToken } from '@/lib/mcp/auth';

/**
 * Token management for the settings page. Session-cookie auth (the signed-in web app); an MCP token can never mint or revoke tokens.
 *   GET     -> { tier, usage:{used,limit}, tokens:[{id,name,prefix,created_at,last_used_at,revoked_at}] }
 *   POST    { name } -> 201 { token, ... }   the secret is returned exactly once
 *   DELETE  { id }   -> { revoked: true }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NS = { 'cache-control': 'no-store' };
const sameOrigin = (req: Request) => {
  const o = req.headers.get('origin'); const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  return (!o || o === new URL(req.url).origin || o === SITE) && ct.startsWith('application/json');
};
const userOf = async (req: Request) => {
  if ((req.headers.get('authorization') ?? '').includes('buk_mcp_')) return null;        // MCP tokens are not accepted here
  return requireUser(req);
};

export async function GET(req: Request) {
  const user = await userOf(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const period = new Date().toISOString().slice(0, 7) + '-01';
  const [{ data: tokens }, { data: usage }, { data: plan }] = await Promise.all([
    admin.from('mcp_tokens').select('id,name,prefix,created_at,last_used_at,revoked_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    admin.from('mcp_usage').select('requests').eq('user_id', user.id).eq('period', period).maybeSingle(),
    admin.from('user_plans').select('plan,current_period_end').eq('user_id', user.id).maybeSingle(),
  ]);
  const pro = !!plan && ['pro', 'team'].includes(plan.plan) && (!plan.current_period_end || new Date(plan.current_period_end) > new Date());
  const tier = pro ? 'pro' : 'free';
  return json({ tier, usage: { used: usage?.requests ?? 0, limit: TIERS[tier].monthly }, tokens: tokens ?? [] }, 200, NS);
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const user = await userOf(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 60) : '';
  if (!name) return json({ error: 'invalid', message: 'Give the token a name, e.g. "Cursor on my laptop".' }, 400, NS);

  const t = generateToken();
  const { data, error } = await admin.rpc('mcp_issue_token', { p_user: user.id, p_name: name, p_hash: t.hash, p_prefix: t.prefix });
  if (error) {
    if ((error.message ?? '').includes('too_many_tokens')) return json({ error: 'too_many_tokens', message: 'You can have up to 5 active tokens. Revoke one first.' }, 409, NS);
    return json({ error: 'server_error' }, 500, NS);
  }
  return json({ id: data, name, prefix: t.prefix, token: t.token, note: 'Copy this token now. It is not stored and cannot be shown again.' }, 201, NS);
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403, NS);
  const user = await userOf(req);
  if (!user) return json({ error: 'unauthorized' }, 401, NS);
  const body = await req.json().catch(() => null);
  if (typeof body?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return json({ error: 'invalid' }, 400, NS);
  const { data } = await admin.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', body.id).eq('user_id', user.id).is('revoked_at', null).select('id');
  return data?.length ? json({ revoked: true }, 200, NS) : json({ error: 'not_found' }, 404, NS);
}

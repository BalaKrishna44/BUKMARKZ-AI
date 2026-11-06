import { admin } from '@/lib/server';
import { authenticateOrg } from '@/lib/mcp/org/auth';
import { defaultOrgDeps } from '@/lib/mcp/org/deps';
import { handleOrgMessage } from '@/lib/mcp/org/protocol';
import type { Outcome } from '@/lib/mcp/protocol';

/**
 * Team Vault MCP endpoint (MCP "Streamable HTTP"), for tools that should know what the whole team has saved.
 *   POST /api/mcp/org     Authorization: Bearer buk_org_...
 * The workspace is derived from the token (org_mcp_authenticate) and is the only thing the search is allowed to touch (match_org_items filters on it
 * in SQL, and the tool re-checks every row). Browser cookies are not accepted, so CSRF does not apply; CORS is open for the same reason as /api/mcp.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY = 256 * 1024, MAX_BATCH = 20;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-session-id, mcp-protocol-version',
  'access-control-expose-headers': 'mcp-session-id',
  'access-control-max-age': '86400',
};
const H = { 'cache-control': 'no-store', ...CORS };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...H, ...(body === null ? {} : { 'content-type': 'application/json' }), ...extra } });
const rpcError = (status: number, code: number, message: string, extra: Record<string, string> = {}) => reply({ jsonrpc: '2.0', id: null, error: { code, message } }, status, extra);

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...H, 'access-control-allow-methods': 'POST, OPTIONS' } });
const notAllowed = () => new Response(null, { status: 405, headers: { ...H, allow: 'POST, OPTIONS' } });
export const GET = notAllowed;
export const DELETE = notAllowed;

export async function POST(req: Request) {
  const auth = await authenticateOrg(req.headers.get('authorization'), admin);
  if (!auth.ok) return rpcError(auth.status, -32001, auth.message, auth.status === 401 ? { 'www-authenticate': 'Bearer realm="Bukmarkz Team Vault", error="invalid_token"' } : { 'retry-after': '5' });

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return rpcError(413, -32600, 'Request too large.');
  const raw = await req.text();
  if (raw.length > MAX_BODY) return rpcError(413, -32600, 'Request too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return rpcError(400, -32700, 'Parse error'); }
  const batch = Array.isArray(parsed);
  const messages = batch ? (parsed as unknown[]) : [parsed];
  if (messages.length === 0 || messages.length > MAX_BATCH) return rpcError(400, -32600, `Batch must contain 1-${MAX_BATCH} messages.`);

  const ctx = { principal: auth.principal, db: admin, deps: defaultOrgDeps() };
  const outcomes: Outcome[] = [];
  for (const m of messages) outcomes.push(await handleOrgMessage(m, ctx));      // sequential: metering and the burst limit stay deterministic

  const responses = outcomes.map((o) => o.body).filter((b): b is NonNullable<Outcome['body']> => b !== null);
  if (responses.length === 0) return new Response(null, { status: 202, headers: H });
  const limited = outcomes.find((o) => o.http && o.http.status >= 429);
  const status = !batch && limited ? limited.http!.status : 200;
  const extra = !batch && limited?.http?.headers ? limited.http.headers : {};
  const payload = batch ? responses : responses[0];
  const accept = req.headers.get('accept') ?? '';
  if (/text\/event-stream/i.test(accept) && !/application\/json|\*\/\*/i.test(accept))
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { status, headers: { ...H, ...extra, 'content-type': 'text/event-stream' } });
  return reply(payload, status, extra);
}

import { admin } from '@/lib/server';
import { authenticate } from '@/lib/mcp/auth';
import { defaultDeps } from '@/lib/mcp/deps';
import { handleMessage, type Outcome } from '@/lib/mcp/protocol';

/**
 * Vault MCP endpoint (MCP "Streamable HTTP" transport), for Claude Desktop, Cursor and any MCP client.
 *   POST /api/mcp   JSON-RPC 2.0 request, notification or batch  ->  application/json (or one SSE event if the client only accepts text/event-stream)
 *   GET/DELETE      405: this server is stateless and never pushes unsolicited messages, which the spec allows
 * Auth: `Authorization: Bearer buk_mcp_...`. Browser cookies are NOT accepted here, so CSRF does not apply.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY = 256 * 1024, MAX_BATCH = 20;
const CORS = {
  'access-control-allow-origin': '*',                                     // bearer-token API: no cookies are involved, so a wildcard exposes nothing
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-session-id, mcp-protocol-version',
  'access-control-expose-headers': 'mcp-session-id',
  'access-control-max-age': '86400',
};
const H = { 'cache-control': 'no-store', ...CORS };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...H, ...(body === null ? {} : { 'content-type': 'application/json' }), ...extra } });
const rpcError = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  reply({ jsonrpc: '2.0', id: null, error: { code, message } }, status, extra);

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...H, 'access-control-allow-methods': 'POST, OPTIONS' } });
const notAllowed = () => new Response(null, { status: 405, headers: { ...H, allow: 'POST, OPTIONS' } });
export const GET = notAllowed;
export const DELETE = notAllowed;

export async function POST(req: Request) {
  const auth = await authenticate(req.headers.get('authorization'), admin);
  if (!auth.ok) return rpcError(auth.status, -32001, auth.message, auth.status === 401 ? { 'www-authenticate': 'Bearer realm="Bukmarkz MCP", error="invalid_token"' } : { 'retry-after': '5' });

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return rpcError(413, -32600, 'Request too large.');
  const raw = await req.text();
  if (raw.length > MAX_BODY) return rpcError(413, -32600, 'Request too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return rpcError(400, -32700, 'Parse error'); }
  const batch = Array.isArray(parsed);
  const messages = batch ? (parsed as unknown[]) : [parsed];
  if (messages.length === 0 || messages.length > MAX_BATCH) return rpcError(400, -32600, `Batch must contain 1-${MAX_BATCH} messages.`);

  const ctx = { principal: auth.principal, db: admin, deps: defaultDeps() };
  // Sequential on purpose: metering and the per-minute burst limit stay deterministic within a batch.
  const outcomes: Outcome[] = [];
  for (const m of messages) outcomes.push(await handleMessage(m, ctx));

  const responses = outcomes.map((o) => o.body).filter((b): b is NonNullable<Outcome['body']> => b !== null);
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: H });                  // only notifications / client responses: accepted, no body
  }
  const limited = outcomes.find((o) => o.http && o.http.status >= 429);        // burst limit / metering outage: surface as HTTP so clients back off
  const status = !batch && limited ? limited.http!.status : 200;
  const extra = !batch && limited?.http?.headers ? limited.http.headers : {};
  const payload = batch ? responses : responses[0];

  const accept = req.headers.get('accept') ?? '';
  if (/text\/event-stream/i.test(accept) && !/application\/json|\*\/\*/i.test(accept))
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { status, headers: { ...H, ...extra, 'content-type': 'text/event-stream' } });
  return reply(payload, status, extra);
}

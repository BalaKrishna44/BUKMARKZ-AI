import { TIERS, limitMessage, meter, refund, writeDeniedMessage, type Principal, type RpcDb } from './auth';
import { listTools, toolByName, validateArgs, type Deps } from './tools';

/** MCP over JSON-RPC 2.0 (Streamable HTTP transport). Pure with respect to HTTP: route.ts only moves bytes. */

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'bukmarkz-vault', title: 'Bukmarkz Vault', version: '1.0.0' };
const INSTRUCTIONS = 'Search and extend the user’s Bukmarkz bookmark vault. Use search_vault before answering questions about things the user saved; use synthesize_vault_topics to brief yourself on a whole topic before coding (it runs several searches and groups results); use get_recent_highlights for “what did I save lately”; use save_bookmark only when the user asks to save a link.';
export const TOOL_TIMEOUT_MS = 28_000;

export type RpcId = string | number | null;
export interface RpcRequest { jsonrpc: '2.0'; id?: RpcId; method: string; params?: any }
export interface RpcResponse { jsonrpc: '2.0'; id: RpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } }
export interface Outcome { body: RpcResponse | null; http?: { status: number; headers?: Record<string, string> } }
export interface Ctx { principal: Principal; db: RpcDb; deps: Deps }

const ok = (id: RpcId, result: unknown): Outcome => ({ body: { jsonrpc: '2.0', id, result } });
const err = (id: RpcId, code: number, message: string, http?: Outcome['http']): Outcome => ({ body: { jsonrpc: '2.0', id, error: { code, message } }, http });
const toolError = (id: RpcId, text: string, extra: Record<string, unknown> = {}): Outcome => ok(id, { content: [{ type: 'text', text }], isError: true, ...extra });

export const isRequest = (m: any): m is RpcRequest => m && typeof m === 'object' && !Array.isArray(m) && m.jsonrpc === '2.0' && typeof m.method === 'string';

export async function handleMessage(msg: unknown, ctx: Ctx): Promise<Outcome> {
  const m = msg as any;
  if (m && typeof m === 'object' && m.jsonrpc === '2.0' && typeof m.method !== 'string' && ('result' in m || 'error' in m)) return { body: null };   // a client *response*: nothing to answer
  if (!isRequest(msg)) return err(null, -32600, 'Invalid Request');
  const hasId = msg.id !== undefined && msg.id !== null;
  const id: RpcId = hasId ? (msg.id as RpcId) : null;
  if (hasId && typeof id !== 'string' && typeof id !== 'number') return err(null, -32600, 'Invalid Request: id must be a string or number');

  // Notifications (no id) never get a response body.
  if (!hasId) return { body: null };

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      const version = (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
      return ok(id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok(id, {});
    case 'tools/list': return ok(id, { tools: listTools() });
    case 'tools/call': return callTool(id, msg.params, ctx);
    default: return err(id, -32601, `Method not found: ${msg.method.slice(0, 80)}`);
  }
}

async function callTool(id: RpcId, params: any, { principal, db, deps }: Ctx): Promise<Outcome> {
  const tool = typeof params?.name === 'string' ? toolByName(params.name) : undefined;
  if (!tool) return err(id, -32602, `Unknown tool: ${String(params?.name ?? '').slice(0, 60)}`);

  // 1. Plan check (free = read-only). Not charged.
  if (tool.access === 'write' && !TIERS[principal.tier].write) return toolError(id, writeDeniedMessage, { structuredContent: { error: 'pro_required' } });
  // 2. Arguments. A malformed call is not charged, and the message lets the model fix it.
  const v = validateArgs(tool.inputSchema, params.arguments);
  if (!v.ok) return toolError(id, `Invalid arguments for ${tool.name}: ${v.message}`, { structuredContent: { error: 'invalid_arguments' } });
  // 3. Meter (atomic in SQL). Fails closed.
  const m = await meter(principal, db);
  if (!m.allowed) {
    if (m.reason === 'burst') return err(id, -32000, `Rate limit: too many requests this minute. Retry in ${m.retryAfter}s.`, { status: 429, headers: { 'retry-after': String(m.retryAfter) } });
    if (m.reason === 'monthly') return toolError(id, limitMessage(m.used, m.limit, deps.now()), { structuredContent: { error: 'free_limit_reached', used: m.used, limit: m.limit } });
    return err(id, -32603, 'Usage metering is temporarily unavailable. Please retry.', { status: 503, headers: { 'retry-after': '5' } });
  }
  // 4. Run, bounded in time. Our failures are refunded and never leak internals.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      tool.run(principal.userId, v.args, deps),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), TOOL_TIMEOUT_MS); }),
    ]);
    return ok(id, {
      content: [{ type: 'text', text: out.text }], structuredContent: out.data, ...(out.isError ? { isError: true } : {}),
      _meta: { usage: { used: m.used, limit: m.limit, tier: principal.tier } },
    });
  } catch (e) {
    await refund(principal, db);
    console.error('mcp tool failed', tool.name, (e as Error).message);              // name + message only, never arguments or results
    return toolError(id, 'Bukmarkz had a temporary problem running this tool. Please try again.', { structuredContent: { error: 'internal' } });
  } finally { if (timer) clearTimeout(timer); }
}

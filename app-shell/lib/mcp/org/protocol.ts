import { SUPPORTED_VERSIONS, TOOL_TIMEOUT_MS, isRequest, type Outcome, type RpcId } from '../protocol';
import { meterOrg, refundOrg, type OrgPrincipal, type RpcDb } from './auth';
import { listOrgTools, orgToolByName, validateArgs, type OrgDeps } from './tools';

/** MCP (JSON-RPC 2.0) for workspace tokens. Same wire behaviour as the personal server; different principal, tools and metering. */
export const ORG_SERVER_INFO = { name: 'bukmarkz-team-vault', title: 'Bukmarkz Team Vault', version: '1.0.0' };
const INSTRUCTIONS = 'Search the team\'s shared Bukmarkz vault. Use search_org_vault before answering questions about what the team has saved.';
export interface OrgCtx { principal: OrgPrincipal; db: RpcDb; deps: OrgDeps }

const ok = (id: RpcId, result: unknown): Outcome => ({ body: { jsonrpc: '2.0', id, result } });
const err = (id: RpcId, code: number, message: string, http?: Outcome['http']): Outcome => ({ body: { jsonrpc: '2.0', id, error: { code, message } }, http });
const toolError = (id: RpcId, text: string, extra: Record<string, unknown> = {}): Outcome => ok(id, { content: [{ type: 'text', text }], isError: true, ...extra });

export async function handleOrgMessage(msg: unknown, ctx: OrgCtx): Promise<Outcome> {
  const m = msg as any;
  if (m && typeof m === 'object' && m.jsonrpc === '2.0' && typeof m.method !== 'string' && ('result' in m || 'error' in m)) return { body: null };
  if (!isRequest(msg)) return err(null, -32600, 'Invalid Request');
  const hasId = msg.id !== undefined && msg.id !== null;
  const id: RpcId = hasId ? (msg.id as RpcId) : null;
  if (hasId && typeof id !== 'string' && typeof id !== 'number') return err(null, -32600, 'Invalid Request: id must be a string or number');
  if (!hasId) return { body: null };
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      const version = (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
      return ok(id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: ORG_SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok(id, {});
    case 'tools/list': return ok(id, { tools: listOrgTools() });
    case 'tools/call': return callTool(id, msg.params, ctx);
    default: return err(id, -32601, `Method not found: ${msg.method.slice(0, 80)}`);
  }
}

async function callTool(id: RpcId, params: any, { principal, db, deps }: OrgCtx): Promise<Outcome> {
  const tool = typeof params?.name === 'string' ? orgToolByName(params.name) : undefined;
  if (!tool) return err(id, -32602, `Unknown tool: ${String(params?.name ?? '').slice(0, 60)}`);
  if (!principal.scopes.includes(tool.scope)) return toolError(id, `This workspace token does not have the "${tool.scope}" scope.`, { structuredContent: { error: 'insufficient_scope' } });
  const v = validateArgs(tool.inputSchema, params.arguments);
  if (!v.ok) return toolError(id, `Invalid arguments for ${tool.name}: ${v.message}`, { structuredContent: { error: 'invalid_arguments' } });
  const m = await meterOrg(principal, db);
  if (!m.allowed) {
    if (m.reason === 'burst') return err(id, -32000, `Rate limit: too many requests this minute. Retry in ${m.retryAfter}s.`, { status: 429, headers: { 'retry-after': String(m.retryAfter) } });
    if (m.reason === 'monthly') return toolError(id, `This workspace has used its monthly MCP allowance (${m.used.toLocaleString('en-US')}/${m.limit.toLocaleString('en-US')} calls). It resets on the 1st (UTC). A workspace admin can add seats at https://bukmarkz.com/pricing`, { structuredContent: { error: 'org_limit_reached', used: m.used, limit: m.limit } });
    return err(id, -32603, 'Usage metering is temporarily unavailable. Please retry.', { status: 503, headers: { 'retry-after': '5' } });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([tool.run(principal, v.args, deps), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), TOOL_TIMEOUT_MS); })]);
    return ok(id, { content: [{ type: 'text', text: out.text }], structuredContent: out.data, ...(out.isError ? { isError: true } : {}) });
  } catch (e) {
    await refundOrg(principal, db);
    console.error('org mcp tool failed', tool.name, (e as Error).message);        // name + message only: never the query or the results
    return toolError(id, 'Bukmarkz had a temporary problem running this tool. Please try again.', { structuredContent: { error: 'internal' } });
  } finally { if (timer) clearTimeout(timer); }
}

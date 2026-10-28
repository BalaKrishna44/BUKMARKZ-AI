// Mock of the supabase-js surface the dashboard uses, with a controllable realtime channel.
type Res = { data?: unknown; error: unknown };
const W = window as unknown as Record<string, any>;
export const state: any = W.__s = { calls: [] as any[], fail: null as null | { message: string; status?: number }, zeroRows: false, channelCb: null as null | ((s: string) => void), handlers: [] as any[], selects: 0, authCb: null as any, signedOut: 0, removed: 0,
  categories: [{ id: 'c1', name: 'Development', position: 0 }, { id: 'c2', name: 'AI & ML', position: 1 }], serverItems: [] as any[] };
W.__emit = (table: string, payload: any) => state.handlers.filter((h: any) => h.table === table).forEach((h: any) => h.cb(payload));
W.__status = (s: string) => state.channelCb?.(s);
W.__auth = (e: string) => state.authCb?.(e, null);
const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 40));
function query(table: string) {
  const q: any = { _op: 'select', _vals: undefined, _col: '', _id: '' };
  q.select = (cols?: string) => { if (q._op === 'select') { q._cols = cols; } else q._ret = true; return q; };
  q.update = (v: unknown) => { q._op = 'update'; q._vals = v; return q; };
  q.delete = () => { q._op = 'delete'; return q; };
  q.eq = (c: string, id: string) => { q._col = c; q._id = id; return q; };
  q.order = () => q; q.limit = () => q; q.returns = () => q;
  q.then = (res: any, rej: any) => {
    state.calls.push({ op: q._op, table, vals: q._vals, col: q._col, id: q._id });
    let out: Res;
    if (q._op === 'select') { state.selects++; out = { data: table === 'categories' ? state.categories : state.serverItems, error: null }; }
    else if (state.fail) out = { data: null, error: state.fail };
    else out = { data: state.zeroRows ? [] : [{ id: q._id }], error: null };
    return later(out).then(res, rej);
  };
  return q;
}
export const createClient = () => ({
  from: query,
  channel: () => { const ch: any = { on: (_t: string, f: any, cb: any) => { state.handlers.push({ table: f.table, filter: f.filter, cb }); return ch; }, subscribe: (cb: any) => { state.channelCb = cb; setTimeout(() => cb('SUBSCRIBED'), 30); return ch; } }; return ch; },
  removeChannel: async () => { state.removed++; },
  auth: { onAuthStateChange: (cb: any) => { state.authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => { state.signedOut++; console.log('SIGNOUT-CALLED'); } },
});

export const state: any = { user: null, cookies: new Map<string,string>(), rpc: [] as any[], rpcResult: { data: 4, error: null } as any, redirected: '' };
export const cookies = async () => ({ get: (k: string) => state.cookies.has(k) ? { value: state.cookies.get(k) } : undefined, set: (k: string, v: string, o: any) => { state.cookies.set(k, v); state.opts = o; }, delete: (k: string) => state.cookies.delete(k) });
export const redirect = (u: string) => { state.redirected = u; throw new Error('NEXT_REDIRECT'); };
export const createClient = async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async (fn: string, a: any) => { state.rpc.push([fn, a]); return state.rpcResult; } });

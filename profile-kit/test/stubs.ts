export const S: any = { user: { id: '11111111-1111-1111-1111-111111111111' }, row: null as any, uploads: [] as any[], removed: [] as string[], upserts: [] as any[], creator: [] as any[], failUpload: false, failSave: false };
export const json = (b: unknown, s = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...h } });
export const requireUser = async () => S.user;
export const admin: any = {
  from: (t: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === 'user_profiles' ? S.row : null }) }) }),
    upsert: async (r: any) => { S.upserts.push(r); if (S.failSave) return { error: { message: 'x' } }; S.row = { ...r }; return { error: null }; },
    update: (r: any) => ({ eq: async () => { S.creator.push(r); return {}; } }),
  }),
  storage: { from: () => ({
    upload: async (p: string, b: Buffer, o: any) => { S.uploads.push({ p, size: b.length, o }); return S.failUpload ? { error: { message: 'x' } } : { error: null }; },
    remove: async (ps: string[]) => { S.removed.push(...ps); return {}; } }) },
};

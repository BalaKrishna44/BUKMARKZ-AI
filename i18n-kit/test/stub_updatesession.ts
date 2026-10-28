export const calls: any[] = [];
export async function updateSession(_req: any, opts: any) { calls.push(opts); return new Response(null, { status: 200, headers: { 'x-session': '1' } }); }

export class NextResponse extends Response {
  cookies = { getAll: () => [] as any[], set: (..._a: any[]) => {} };
  static redirect(url: URL | string, status = 307) { const r = new NextResponse(null, { status, headers: { location: String(url) } }); return r; }
  static next(_o?: any) { const r = new NextResponse(null, { status: 200 }); r.headers.set('x-next', '1'); return r; }
}
export type NextRequest = any;

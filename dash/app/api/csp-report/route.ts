/** Receives CSP violation reports (report-only phase). Public endpoint, so it is deliberately boring: size-capped, logs one sanitised line, never echoes input. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const clean = (v: unknown) => String(v ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 200);

export async function POST(req: Request) {
  try {
    const text = (await req.text()).slice(0, 8192);
    const r = (JSON.parse(text) as { 'csp-report'?: Record<string, unknown> })['csp-report'];
    if (r) console.warn(`[csp] directive=${clean(r['violated-directive'])} blocked=${clean(r['blocked-uri'])} doc=${clean(r['document-uri'])}`);
  } catch { /* malformed report: ignore */ }
  return new Response(null, { status: 204 });
}

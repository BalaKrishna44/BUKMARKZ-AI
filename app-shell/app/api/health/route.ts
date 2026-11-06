export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Liveness probe for Docker/Coolify. Deliberately touches no database and returns nothing about the system. */
export const GET = () => new Response('ok', { status: 200, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } });

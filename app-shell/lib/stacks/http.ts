import type { NextRequest } from 'next/server';
import { SITE } from './public';

/** Same-origin + JSON-only for cookie-authenticated writes. A cross-site <form> can't send application/json, and browsers always send Origin on cross-origin POST/DELETE. */
export function safeWrite(req: NextRequest): boolean {
  const o = req.headers.get('origin');
  if (o && o !== req.nextUrl.origin && o !== SITE) return false;
  return (req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json');
}
export const NO_STORE = { 'cache-control': 'private, no-store' } as const;

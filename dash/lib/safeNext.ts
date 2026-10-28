/** `?next=` must be a path on THIS site. Anything else (https://evil.test, //evil.test, /\evil.test) falls back to the dashboard. */
export function safeNext(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || raw.length > 512 || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return fallback;
  try { const u = new URL(raw, 'http://local.invalid'); return u.origin === 'http://local.invalid' ? u.pathname + u.search + u.hash : fallback; } catch { return fallback; }
}

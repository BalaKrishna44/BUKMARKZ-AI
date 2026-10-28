import { SIGN_IN_URL } from '../shared/config';
import { getSession } from '../shared/storage';
import type { SessionUser } from '../shared/types';

/**
 * How a login reaches the extension (no password is ever typed here):
 *   web app --(window.postMessage)--> content script bridge.ts (runs only on bukmarkz.com)
 *           --(chrome.runtime.sendMessage 'bridge:login')--> service worker
 *           --> verifies the token with GET /api/ingest, then writes it to chrome.storage.local ('bukmarkz.session')
 * The popup only READS that session. It never accepts tokens from web pages itself.
 * Only the short-lived ACCESS token is shared, never the refresh token (see shared/types.ts).
 */
export type AuthState =
  | { status: 'signed-out' }
  | { status: 'expired'; user: SessionUser }                                  // signed in before; the website must refresh the token
  | { status: 'signed-in'; user: SessionUser; token: string; expiresAt: number };

const SKEW_S = 30;
export async function getAuthState(now = Date.now()): Promise<AuthState> {
  const s = await getSession();
  if (!s) return { status: 'signed-out' };
  if (s.expiresAt - SKEW_S <= now / 1000) return { status: 'expired', user: s.user };
  return { status: 'signed-in', user: s.user, token: s.accessToken, expiresAt: s.expiresAt };
}

/** Calls back whenever the session changes (sign-in on the website, token refresh, sign-out). Returns an unsubscribe. */
export function onAuthChange(cb: () => void): () => void {
  const h = (changes: Record<string, unknown>, area: string) => { if (area === 'local' && 'bukmarkz.session' in changes) cb(); };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}

export const openSignIn = () => chrome.tabs.create({ url: SIGN_IN_URL });

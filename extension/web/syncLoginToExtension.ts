/**
 * Web app side of the Bukmarkz extension bridge.
 *
 *   Supabase onAuthStateChange --> window.postMessage --> content script (bridge.ts) --> service worker --> chrome.storage.local
 *
 * Mount once, in a client component that lives for the whole session (e.g. your root layout's <Providers>):
 *
 *   useEffect(() => startExtensionSync(supabase), []);
 *
 * Only the ACCESS token is shared. The refresh token never leaves the website: Supabase rotates refresh tokens, so if
 * the extension held a copy, whichever client refreshed second would invalidate the other and sign the user out.
 * The extension therefore re-receives a new access token every time this tab refreshes (about hourly while the site is open).
 * If the extension is not installed, nothing happens.
 */
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

const CHANNEL = 'bukmarkz.bridge.v1';
type Ack = { ok: boolean; code?: string; type?: string };

function request(type: 'AUTH_LOGIN' | 'AUTH_LOGOUT', payload?: { accessToken: string }, timeoutMs = 2000): Promise<Ack | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const done = (v: Ack | null) => { window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(v); };
    const onMsg = (e: MessageEvent) => {
      // only our own window, same origin, and only the reply to THIS request
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data;
      if (d?.channel === CHANNEL && d?.from === 'extension' && d?.requestId === requestId) done(d as Ack);
    };
    const timer = setTimeout(() => done(null), timeoutMs);     // no reply = extension not installed
    window.addEventListener('message', onMsg);
    // targetOrigin is our own origin, never "*"
    window.postMessage({ channel: CHANNEL, from: 'page', type, requestId, payload }, window.location.origin);
  });
}

/** Events that carry a session worth sharing. PASSWORD_RECOVERY is deliberately absent: that is a limited session. */
const SHARE: ReadonlySet<AuthChangeEvent> = new Set(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']);

export function startExtensionSync(supabase: SupabaseClient): () => void {
  let lastSent: string | null = null;      // access token last accepted by the extension ('' = told it we signed out)
  let chain: Promise<unknown> = Promise.resolve(); // one message at a time, in order

  const push = (session: Session | null) => {
    chain = chain.then(async () => {
      if (!session) {
        if (lastSent === '') return;
        const ack = await request('AUTH_LOGOUT');
        if (ack?.ok) lastSent = '';
        return;
      }
      if (session.access_token === lastSent) return;      // already delivered (many tabs / duplicate events)
      const ack = await request('AUTH_LOGIN', { accessToken: session.access_token });
      if (ack?.ok) lastSent = session.access_token;
      // ack null = no extension; ack.ok false = it refused (e.g. another account is connected). Either way: don't retry in a loop.
    }).catch(() => undefined);
  };

  // IMPORTANT: do not await Supabase calls inside this callback (it can deadlock the client). Defer the work.
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') setTimeout(() => push(null), 0);
    else if (SHARE.has(event)) setTimeout(() => push(session), 0);
  });

  // The extension announces itself when its content script loads (installed or updated while this tab was open): re-send then.
  const onReady = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    if (e.data?.channel === CHANNEL && e.data?.from === 'extension' && e.data?.type === 'READY') {
      lastSent = null;
      void supabase.auth.getSession().then(({ data }) => push(data.session));
    }
  };
  window.addEventListener('message', onReady);

  return () => { subscription.unsubscribe(); window.removeEventListener('message', onReady); };
}

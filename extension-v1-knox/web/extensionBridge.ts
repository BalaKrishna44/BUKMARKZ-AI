/**
 * Add this file to the Bukmarkz React app. Call `syncLoginToExtension` right after a successful
 * sign-in (password, magic link, OAuth or passkey) and `syncLogoutToExtension` on sign-out.
 * If the extension is not installed, every call resolves quietly and nothing happens.
 */
const CHANNEL = 'bukmarkz.bridge.v1';

export interface BridgeAck { ok: boolean; code?: string; connected?: boolean; user?: { id: number; email: string } | null }

function request(type: 'HELLO' | 'AUTH_LOGIN' | 'AUTH_LOGOUT' | 'STATUS', payload?: object, timeoutMs = 1500): Promise<BridgeAck | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const done = (v: BridgeAck | null) => { window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(v); };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data;
      if (d?.channel !== CHANNEL || d?.from !== 'extension' || d?.requestId !== requestId) return;
      done(d as BridgeAck);
    };
    const timer = setTimeout(() => done(null), timeoutMs); // no reply = extension not installed
    window.addEventListener('message', onMsg);
    window.postMessage({ channel: CHANNEL, from: 'page', type, requestId, payload }, window.location.origin);
  });
}

export const isExtensionInstalled = async () => (await request('HELLO')) !== null;
export const syncLoginToExtension = (token: string, expiry: string | null) => request('AUTH_LOGIN', { token, expiry });
export const syncLogoutToExtension = () => request('AUTH_LOGOUT');
export const extensionStatus = () => request('STATUS');

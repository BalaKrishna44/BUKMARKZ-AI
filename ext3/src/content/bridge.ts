/**
 * Web bridge. Runs on bukmarkz.com only (see manifest `content_scripts`).
 *
 *   page  --window.postMessage-->  bridge (this file)  --chrome.runtime.sendMessage-->  service worker
 *
 * Security rules:
 *  - accept messages only from this same window and this same origin;
 *  - accept only a fixed set of message types, with size and rate limits;
 *  - the access token flows page -> extension, never back: replies contain no token;
 *  - the service worker re-checks the sender and verifies the token with the server before storing it.
 */
import { BRIDGE_CHANNEL, EXTENSION_VERSION, LIMITS } from '../shared/config';
import { looksLikeJwt } from '../shared/jwt';
import type { ToBridge, ToWorker, WorkerReply } from '../shared/messages';

export interface BridgeEnv {
  win: Pick<Window, 'addEventListener' | 'postMessage' | 'location'>;
  sendToWorker: (m: ToWorker) => Promise<WorkerReply>;
  now?: () => number;
}

type PageMessage = {
  channel: typeof BRIDGE_CHANNEL;
  from: 'page';
  type: 'HELLO' | 'AUTH_LOGIN' | 'AUTH_LOGOUT' | 'STATUS';
  requestId: string;
  payload?: { accessToken?: unknown };
};

const TYPES = new Set(['HELLO', 'AUTH_LOGIN', 'AUTH_LOGOUT', 'STATUS']);
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 10;

function parse(data: unknown): PageMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.channel !== BRIDGE_CHANNEL || d.from !== 'page') return null;
  if (typeof d.type !== 'string' || !TYPES.has(d.type)) return null;
  if (typeof d.requestId !== 'string' || d.requestId.length === 0 || d.requestId.length > 64) return null;
  let size = 0;
  try { size = JSON.stringify(d).length; } catch { return null; }
  if (size > LIMITS.bridgePayloadBytes) return null;
  return d as unknown as PageMessage;
}

export function createBridge({ win, sendToWorker, now = Date.now }: BridgeEnv) {
  const origin = win.location.origin;
  let stamps: number[] = [];

  const reply = (body: Record<string, unknown>) =>
    win.postMessage({ channel: BRIDGE_CHANNEL, from: 'extension', version: EXTENSION_VERSION, ...body }, origin);

  const allowed = () => {
    const t = now();
    stamps = stamps.filter((s) => t - s < WINDOW_MS);
    if (stamps.length >= MAX_PER_WINDOW) return false;
    stamps.push(t);
    return true;
  };

  async function relay(msg: PageMessage): Promise<WorkerReply> {
    switch (msg.type) {
      case 'AUTH_LOGIN': {
        const { accessToken } = msg.payload ?? {};
        if (!looksLikeJwt(accessToken)) return { ok: false, error: 'Bad token.', code: 'bad_input' };
        return sendToWorker({ type: 'bridge:login', accessToken });
      }
      case 'AUTH_LOGOUT':
        return sendToWorker({ type: 'bridge:logout' });
      default:
        return sendToWorker({ type: 'session:get' });
    }
  }

  async function onMessage(event: MessageEvent): Promise<void> {
    if (event.source !== (win as unknown as Window)) return;   // not from iframes or other windows
    if (event.origin !== origin) return;                       // not from a different origin
    const msg = parse(event.data);
    if (!msg) return;
    if (!allowed()) return reply({ type: 'ACK', requestId: msg.requestId, ok: false, code: 'rate_limited' });
    if (msg.type === 'HELLO') return reply({ type: 'READY', requestId: msg.requestId, ok: true });
    try {
      const res = await relay(msg);
      const user = res.ok && res.session ? { id: res.session.user.id, email: res.session.user.email } : null;
      reply({ type: 'ACK', requestId: msg.requestId, ok: res.ok, code: res.ok ? undefined : res.code ?? 'error', connected: Boolean(user), user });
    } catch {
      // e.g. the extension was updated while this page stayed open
      reply({ type: 'ACK', requestId: msg.requestId, ok: false, code: 'extension_unavailable' });
    }
  }

  /** The worker found its token expired and asks the page (which holds the refresh token) to send a fresh one. No token travels here. */
  function onWorkerMessage(message: unknown, senderId: string | undefined, ownId: string | undefined): boolean {
    if (!ownId || senderId !== ownId) return false;                                  // only our own extension
    if ((message as ToBridge | null)?.type !== 'bridge:refresh-request') return false;
    reply({ type: 'REFRESH_REQUEST', requestId: 'refresh-' + now() });
    return true;
  }

  win.addEventListener('message', (e) => void onMessage(e as MessageEvent));
  reply({ type: 'READY', requestId: 'announce', ok: true });
  return { onMessage, onWorkerMessage };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
  const bridge = createBridge({ win: window, sendToWorker: (m) => chrome.runtime.sendMessage(m) as Promise<WorkerReply> });
  chrome.runtime.onMessage.addListener((m, sender) => { bridge.onWorkerMessage(m, sender.id, chrome.runtime.id); });
}

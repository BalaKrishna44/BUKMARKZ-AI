import type { SaveInput, SavedItem, Session } from './types';

/** Messages the popup / overlay / bridge send to the service worker. */
export type ToWorker =
  | { type: 'bridge:login'; accessToken: string }
  | { type: 'bridge:logout' }
  | { type: 'session:get' }
  | { type: 'save'; input: SaveInput }
  | { type: 'recent:get' }
  | { type: 'tags:get' }
  | { type: 'recent:remove'; id: string }
  | { type: 'queue:flush' };

export type WorkerReply =
  | { ok: true; session?: Pick<Session, 'user' | 'expiresAt'> | null; item?: SavedItem; items?: SavedItem[]; tags?: string[] }
  | { ok: false; error: string; code?: 'not_signed_in' | 'invalid_token' | 'bad_input' | 'network' | 'server' };

/** Messages the service worker sends to a tab's overlay. */
export type ToOverlay = { type: 'overlay:toggle'; mode?: 'save' };

export function send(message: ToWorker): Promise<WorkerReply> {
  return chrome.runtime.sendMessage(message) as Promise<WorkerReply>;
}

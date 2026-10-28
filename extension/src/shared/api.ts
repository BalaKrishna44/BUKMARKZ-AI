import { API_BASE, INGEST_PATH } from './config';
import type { SaveInput, SessionUser } from './types';

export class ApiError extends Error {
  constructor(public code: 'invalid_token' | 'network' | 'server' | 'bad_input', message: string) {
    super(message);
  }
}

async function request(token: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${INGEST_PATH}`, {
      ...init,
      credentials: 'omit', // Bearer token only, never cookies
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
    });
  } catch {
    throw new ApiError('network', 'Could not reach Bukmarkz.');
  }
}

/** Ask the server to verify the JWT's signature and tell us who it belongs to. */
export async function fetchUser(token: string): Promise<SessionUser> {
  const res = await request(token, { method: 'GET' });
  if (res.status === 401 || res.status === 403) throw new ApiError('invalid_token', 'That session is not valid.');
  if (!res.ok) throw new ApiError('server', `Server answered ${res.status}.`);
  const body = (await res.json()) as { user?: Partial<SessionUser> };
  if (typeof body.user?.id !== 'string' || typeof body.user?.email !== 'string') throw new ApiError('server', 'Unexpected user response.');
  return { id: body.user.id, email: body.user.email };
}

export interface SaveResult { id: string; created: boolean }

/** POST /api/ingest. The server decides what to do from `kind`: page, selection (rich note) or image. */
export async function saveBookmark(token: string, input: SaveInput): Promise<SaveResult> {
  const res = await request(token, {
    method: 'POST',
    body: JSON.stringify({ kind: input.kind, url: input.url, title: input.title, note: input.note, tags: input.tags, imageUrl: input.imageUrl }),
  });
  if (res.status === 401 || res.status === 403) throw new ApiError('invalid_token', 'Please sign in again.');
  if (res.status === 400 || res.status === 413) throw new ApiError('bad_input', 'Bukmarkz could not accept this page.');
  if (!res.ok) throw new ApiError('server', `Server answered ${res.status}.`);
  const body = (await res.json()) as { id: string; created: boolean };
  return { id: String(body.id), created: Boolean(body.created) };
}

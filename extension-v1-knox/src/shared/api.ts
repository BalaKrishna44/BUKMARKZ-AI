import { API_BASE } from './config';
import type { SaveInput, SessionUser } from './types';

export class ApiError extends Error {
  constructor(public code: 'invalid_token' | 'network' | 'server' | 'bad_input', message: string) {
    super(message);
  }
}

async function request(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'omit', // we authenticate with the token header only, never cookies
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${token}`, ...init.headers },
    });
  } catch {
    throw new ApiError('network', 'Could not reach Bukmarkz.');
  }
}

/** Ask the server who this token belongs to. Throws invalid_token on 401/403. */
export async function fetchUser(token: string): Promise<SessionUser> {
  const res = await request('/api/auth/user/', token);
  if (res.status === 401 || res.status === 403) throw new ApiError('invalid_token', 'That session is not valid.');
  if (!res.ok) throw new ApiError('server', `Server answered ${res.status}.`);
  const body = (await res.json()) as Partial<SessionUser>;
  if (typeof body.id !== 'number' || typeof body.email !== 'string') throw new ApiError('server', 'Unexpected user response.');
  return { id: body.id, email: body.email, username: body.username };
}

export async function logoutRemote(token: string): Promise<void> {
  await request('/api/auth/logout/', token, { method: 'POST' }).catch(() => undefined);
}

export interface SaveResult { id: number; created: boolean }

export async function saveBookmark(token: string, input: SaveInput): Promise<SaveResult> {
  const res = await request('/api/extension/bookmarks/', token, {
    method: 'POST',
    // `note` and `tags` are sent for the day the server stores them; today it keeps url/title/description.
    body: JSON.stringify({ url: input.url, title: input.title, description: '', note: input.note, tags: input.tags }),
  });
  if (res.status === 401 || res.status === 403) throw new ApiError('invalid_token', 'Please sign in again.');
  if (res.status === 400) throw new ApiError('bad_input', 'Bukmarkz could not accept this page.');
  if (!res.ok) throw new ApiError('server', `Server answered ${res.status}.`);
  const body = (await res.json()) as { id: number; created: boolean };
  return { id: body.id, created: body.created };
}

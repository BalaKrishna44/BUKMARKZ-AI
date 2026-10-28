import { supabase } from './supabaseClient';

const BASE = process.env.API_BASE_URL!; // e.g. https://app.example.com

async function call<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession(); // refreshes the access token when needed
  const token = data.session?.access_token;
  if (!token) throw new Error('not signed in');
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`${path} -> ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

export type PresignResponse =
  | { duplicate: true; photoId: string }
  | { duplicate: false; photoId: string; uploadUrl: string; headers: Record<string, string> };

export const api = {
  presign: (b: unknown) => call<PresignResponse>('/api/storage/presigned-url', b),
  complete: (photoId: string) => call<{ status: 'verified' }>('/api/storage/complete', { photoId }),
  verify: (fileHashes: string[]) => call<{ verified: { fileHash: string; photoId: string }[] }>('/api/photos/verify', { fileHashes }),
};

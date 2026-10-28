import { checkUrl, cleanText, normalizeTags } from '@/lib/import/normalize';

export type Kind = 'page' | 'selection' | 'image';
export interface IngestBody { kind: Kind; url: string; urlKey: string; title: string; note: string | null; tags: string[]; imageUrl: string | null; faviconUrl: string | null; description: string | null }
export interface DbItem { id: string; note: string | null; tags: string[] }

export interface IngestDeps {
  /** Verifies the JWT with Supabase Auth (signature, expiry, revocation). */
  getUser(jwt: string): Promise<{ id: string; email: string } | null>;
  find(userId: string, urlKey: string): Promise<DbItem | null>;
  insert(row: { user_id: string; url: string; url_key: string; title: string; note: string | null; tags: string[]; source: string; favicon_url: string | null; meta_description: string | null }): Promise<string>;
  update(id: string, patch: { note?: string | null; tags?: string[] }): Promise<void>;
}

export type IngestResult = { status: number; body: Record<string, unknown> };
const MAX_BODY = 64 * 1024;
const KIND_TAG: Record<Kind, string | null> = { page: null, selection: 'note', image: 'image' };

export function parseIngest(text: string): { ok: true; value: IngestBody } | { ok: false } {
  if (text.length > MAX_BODY) return { ok: false };
  let j: any; try { j = JSON.parse(text); } catch { return { ok: false }; }
  if (!j || typeof j !== 'object' || !['page', 'selection', 'image'].includes(j.kind)) return { ok: false };
  const u = checkUrl(j.url); if (!u.ok) return { ok: false };
  let imageUrl: string | null = null;
  if (j.kind === 'image') { const i = checkUrl(j.imageUrl); if (!i.ok) return { ok: false }; imageUrl = i.url; }
  // favicon is page-controlled: accept only a plain http(s) URL, never data:/javascript:, and cap lengths
  let faviconUrl: string | null = null;
  if (typeof j.favicon === 'string' && j.favicon.length <= 2048) { const f = checkUrl(j.favicon); if (f.ok) faviconUrl = f.url; }
  const description = cleanText(j.description, 300) || null;
  return { ok: true, value: {
    kind: j.kind, url: u.url, urlKey: u.key,
    title: cleanText(j.title, 500), note: cleanText(j.note, 10_000) || null,
    tags: normalizeTags(Array.isArray(j.tags) ? j.tags.filter((t: unknown) => typeof t === 'string') : []), imageUrl, faviconUrl, description,
  } };
}

/** Append a new note to an existing one, unless it is already there (queue replays must not duplicate it). */
export function mergeNote(existing: string | null, incoming: string | null): string | null {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.includes(incoming)) return existing;
  return `${existing}\n\n${incoming}`.slice(0, 10_000);
}

const bearer = (h: string | null) => /^Bearer\s+(\S{20,4096})$/i.exec(h ?? '')?.[1] ?? null;

export async function handleIngest(d: IngestDeps, authorization: string | null, method: 'GET' | 'POST', bodyText = ''): Promise<IngestResult> {
  const jwt = bearer(authorization);
  const user = jwt ? await d.getUser(jwt).catch(() => null) : null;
  if (!user) return { status: 401, body: { code: 'invalid_token' } };
  if (method === 'GET') return { status: 200, body: { user: { id: user.id, email: user.email } } };   // lets the extension verify a token

  const p = parseIngest(bodyText);
  if (!p.ok) return { status: 400, body: { code: 'bad_input' } };
  const b = p.value, extra = KIND_TAG[b.kind];
  const tags = normalizeTags([...b.tags, ...(extra ? [extra] : [])]);

  const existing = await d.find(user.id, b.urlKey);
  if (!existing) {
    const id = await d.insert({ user_id: user.id, url: b.url, url_key: b.urlKey, title: b.title || new URL(b.url).hostname, note: b.note, tags, source: `extension:${b.kind}`, favicon_url: b.faviconUrl, meta_description: b.description });
    return { status: 201, body: { id, created: true, kind: b.kind } };
  }
  // The page is already saved: a selection or image adds to ITS note instead of creating a duplicate.
  const note = mergeNote(existing.note, b.note), merged = normalizeTags([...existing.tags, ...tags]);
  if (note !== existing.note || merged.length !== existing.tags.length) await d.update(existing.id, { note, tags: merged });
  return { status: 200, body: { id: existing.id, created: false, kind: b.kind } };
}

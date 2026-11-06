import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { admin, json, requireUser } from '@/lib/server';
import { MAX_UPLOAD, MIN_INTERVAL_MS, SIZE, avatarPath, pathFromUrl, publicAvatarUrl, sameOriginOrBearer, sniffImage } from '@/lib/profile/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'avatars';

/**
 * POST multipart/form-data { file }: set the signed-in user's profile picture.
 * Flow: same-origin check -> auth -> size precheck -> sniff real type -> pause between uploads -> decode and re-encode
 * (square crop, 256x256, EXIF rotation applied, ALL metadata including GPS dropped) -> store under a content-hash name -> save address -> delete the old file.
 * Re-encoding means whatever the user sent (polyglot files, scripts in metadata, huge dimensions) never reaches storage.
 */
export async function POST(req: Request) {
  if (!sameOriginOrBearer(req)) return json({ error: 'forbidden' }, 403);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) return json({ error: 'expected_multipart' }, 415);
  const len = Number(req.headers.get('content-length'));
  if (!Number.isFinite(len) || len <= 0) return json({ error: 'length_required' }, 411);
  if (len > MAX_UPLOAD + 64 * 1024) return json({ error: 'too_large', max_bytes: MAX_UPLOAD }, 413);

  let file: FormDataEntryValue | null;
  try { file = (await req.formData()).get('file'); } catch { return json({ error: 'bad_form' }, 400); }
  if (!(file instanceof File) || file.size === 0) return json({ error: 'no_file' }, 400);
  if (file.size > MAX_UPLOAD) return json({ error: 'too_large', max_bytes: MAX_UPLOAD }, 413);
  const input = Buffer.from(await file.arrayBuffer());
  if (!sniffImage(input)) return json({ error: 'unsupported_type', accepted: ['jpeg', 'png', 'webp'] }, 415);

  const { data: prev } = await admin.from('user_profiles').select('avatar_url, updated_at').eq('user_id', user.id).maybeSingle();
  if (prev?.updated_at && Date.now() - new Date(prev.updated_at).getTime() < MIN_INTERVAL_MS) return json({ error: 'slow_down' }, 429, { 'retry-after': '5' });

  let out: Buffer;
  try {
    out = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().resize(SIZE, SIZE, { fit: 'cover' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  } catch { return json({ error: 'unreadable_image' }, 422); }

  const path = avatarPath(user.id, createHash('sha256').update(out).digest('hex').slice(0, 16));
  const url = path && publicAvatarUrl(process.env.SUPABASE_URL!, path);
  if (!path || !url) return json({ error: 'server_misconfigured' }, 500);

  const up = await admin.storage.from(BUCKET).upload(path, out, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
  if (up.error) { console.error('avatar upload failed'); return json({ error: 'storage_failed' }, 502); }

  const now = new Date().toISOString();
  const save = await admin.from('user_profiles').upsert({ user_id: user.id, avatar_url: url, updated_at: now }, { onConflict: 'user_id' });
  if (save.error) { await admin.storage.from(BUCKET).remove([path]); console.error('avatar save failed'); return json({ error: 'save_failed' }, 500); }
  await admin.from('creator_profiles').update({ avatar_url: url }).eq('user_id', user.id);    // public Stacks show the same picture (no-op without a handle)

  const old = pathFromUrl(prev?.avatar_url, user.id);
  if (old && old !== path) await admin.storage.from(BUCKET).remove([old]);
  return json({ url });
}

/** DELETE: remove the picture (file + address). The app falls back to the initial letter. */
export async function DELETE(req: Request) {
  if (!sameOriginOrBearer(req)) return json({ error: 'forbidden' }, 403);
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: prev } = await admin.from('user_profiles').select('avatar_url').eq('user_id', user.id).maybeSingle();
  const old = pathFromUrl(prev?.avatar_url, user.id);
  if (old) await admin.storage.from(BUCKET).remove([old]);
  await admin.from('user_profiles').upsert({ user_id: user.id, avatar_url: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  await admin.from('creator_profiles').update({ avatar_url: null }).eq('user_id', user.id);
  return json({ ok: true });
}

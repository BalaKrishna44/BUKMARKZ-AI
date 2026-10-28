import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { admin, BUCKET, json, MAX_OBJECT_BYTES, r2, requireUser } from '@/lib/server';

export const runtime = 'nodejs';

const b64 = (len: number) =>
  z.string().refine((s) => {
    try { return Buffer.from(s, 'base64').length === len; } catch { return false; }
  }, `must be base64 of ${len} bytes`);

const Body = z.object({
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  ciphertextSize: z.number().int().min(29).max(MAX_OBJECT_BYTES),
  plaintextSize: z.number().int().min(0),
  encryptionIv: b64(12),
  wrappedKey: b64(60),
  chunkSizeLog2: z.number().int().min(16).max(26),
  mediaType: z.enum(['image', 'video']),
  takenAt: z.string().datetime().optional(),
});

const URL_TTL_SECONDS = 600; // short-lived: enough for one large upload on a slow link

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'bad_request', detail: parsed.error.flatten() }, 400);
  const b = parsed.data;

  // Existing row for this user+fingerprint?
  const { data: existing } = await admin
    .from('user_photos')
    .select('photo_id, upload_status, object_key')
    .eq('user_id', user.id)
    .eq('file_hash', b.fileHash)
    .maybeSingle();

  if (existing?.upload_status === 'verified') {
    return json({ duplicate: true, photoId: existing.photo_id });
  }

  const row = {
    user_id: user.id,
    file_hash: b.fileHash,
    encryption_iv: `\\x${Buffer.from(b.encryptionIv, 'base64').toString('hex')}`,
    wrapped_key: `\\x${Buffer.from(b.wrappedKey, 'base64').toString('hex')}`,
    chunk_size_log2: b.chunkSizeLog2,
    file_size_bytes: b.ciphertextSize,
    plaintext_size_bytes: b.plaintextSize,
    media_type: b.mediaType,
    taken_at: b.takenAt ?? null,
  };

  let photoId: string;
  if (existing) {
    // A previous attempt never finished. The client re-encrypted with a fresh key/IV, so overwrite the metadata.
    photoId = existing.photo_id;
    const { error } = await admin.from('user_photos').update(row).eq('photo_id', photoId).eq('user_id', user.id);
    if (error) return json({ error: 'db_error' }, 500);
  } else {
    photoId = crypto.randomUUID();
    const { error } = await admin.from('user_photos').insert({
      ...row,
      photo_id: photoId,
      object_key: `${user.id}/${photoId}`, // server-chosen: the client can never pick or traverse a key
    });
    if (error) {
      if (error.code === '23505') return json({ error: 'conflict_retry' }, 409); // concurrent upload of same file
      return json({ error: 'db_error' }, 500);
    }
  }

  const key = `${user.id}/${photoId}`;
  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: 'application/octet-stream',
      ContentLength: b.ciphertextSize, // signed: R2 rejects a body of any other size
    }),
    { expiresIn: URL_TTL_SECONDS },
  );

  return json({
    duplicate: false,
    photoId,
    uploadUrl,
    headers: { 'Content-Type': 'application/octet-stream' },
    expiresInSeconds: URL_TTL_SECONDS,
  });
}

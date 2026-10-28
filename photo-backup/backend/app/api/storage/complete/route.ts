import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { admin, BUCKET, json, r2, requireUser } from '@/lib/server';

export const runtime = 'nodejs';

const Body = z.object({ photoId: z.string().uuid() });

/**
 * Only the SERVER can move a row to 'verified': it HEADs the object in R2 and checks the
 * stored byte length equals the size declared (and signed) at presign time.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);

  const { data: row } = await admin
    .from('user_photos')
    .select('photo_id, object_key, file_size_bytes, upload_status')
    .eq('photo_id', parsed.data.photoId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.upload_status === 'verified') return json({ status: 'verified' });

  let length: number | undefined;
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.object_key }));
    length = head.ContentLength;
  } catch {
    return json({ error: 'object_missing' }, 409);
  }

  if (length !== Number(row.file_size_bytes)) {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: row.object_key })).catch(() => {});
    return json({ error: 'size_mismatch' }, 409); // row stays 'pending'; client retries from scratch
  }

  const { error } = await admin
    .from('user_photos')
    .update({ upload_status: 'verified', verified_at: new Date().toISOString() })
    .eq('photo_id', row.photo_id)
    .eq('user_id', user.id)
    .eq('upload_status', 'pending');
  if (error) return json({ error: 'db_error' }, 500);
  return json({ status: 'verified' });
}

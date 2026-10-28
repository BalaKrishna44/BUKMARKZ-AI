import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { admin, BUCKET, json, r2, requireUser } from '@/lib/server';

export const runtime = 'nodejs';

const Body = z.object({ fileHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(200) });

/**
 * "Free up space" gate. For each fingerprint the client claims is backed up, answer true only if
 * a row is 'verified' AND the object still exists in R2 with the recorded size right now
 * (guards against lifecycle rules, manual deletes, or bucket mishaps since the original upload).
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);

  const { data: rows, error } = await admin
    .from('user_photos')
    .select('photo_id, file_hash, object_key, file_size_bytes')
    .eq('user_id', user.id)
    .eq('upload_status', 'verified')
    .in('file_hash', parsed.data.fileHashes);
  if (error) return json({ error: 'db_error' }, 500);

  const verified: { fileHash: string; photoId: string }[] = [];
  const queue = [...(rows ?? [])];
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      for (let r = queue.pop(); r; r = queue.pop()) {
        try {
          const head = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r.object_key }));
          if (head.ContentLength === Number(r.file_size_bytes)) {
            verified.push({ fileHash: r.file_hash, photoId: r.photo_id });
          }
        } catch { /* missing object => not verified */ }
      }
    }),
  );
  return json({ verified });
}

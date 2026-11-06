import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { admin } from '@/lib/server';
import { BUCKETS } from './core';

/** Remove every file a user has in Supabase Storage (<bucket>/<userId>/...). Returns how many were deleted; throws if any batch fails so the caller can stop before deleting the login. */
export async function eraseSupabaseFiles(userId: string): Promise<number> {
  let removed = 0;
  for (const bucket of BUCKETS) {
    for (let guard = 0; guard < 200; guard++) {                    // up to 200,000 files per bucket
      const { data, error } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
      if (error) throw new Error(`list_failed:${bucket}`);
      if (!data?.length) break;
      const { error: rmErr } = await admin.storage.from(bucket).remove(data.map((f) => `${userId}/${f.name}`));
      if (rmErr) throw new Error(`remove_failed:${bucket}`);
      removed += data.length;
    }
  }
  return removed;
}

/** Podcast audio lives in Cloudflare R2 under podcasts/<userId>/. Skipped when R2 is not configured. */
export async function eraseR2Files(userId: string): Promise<number> {
  if (!process.env.R2_BUCKET || !process.env.R2_ACCOUNT_ID) return 0;
  const { r2 } = await import('@/lib/podcast/r2');
  const Bucket = process.env.R2_BUCKET, Prefix = `podcasts/${userId}/`;
  let removed = 0, token: string | undefined;
  do {
    const page = await r2.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token, MaxKeys: 1000 }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((k) => k.Key.startsWith(Prefix));
    if (keys.length) {
      const res = await r2.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
      if (res.Errors?.length) throw new Error('r2_remove_failed');
      removed += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
}

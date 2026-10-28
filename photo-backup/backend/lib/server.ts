import { createClient } from '@supabase/supabase-js';
import { S3Client } from '@aws-sdk/client-s3';

export const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Mobile clients send `Authorization: Bearer <supabase access token>`. Returns the verified user or null. */
export async function requireUser(req: Request) {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token); // validates signature + expiry server-side
  return error || !data.user ? null : data.user;
}

// Cloudflare R2 (S3 compatible). For AWS S3 drop `endpoint` and set a real region.
export const BUCKET = process.env.R2_BUCKET!;
export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  // Newer SDK versions add CRC32 trailers by default, which R2 rejects on presigned PUTs.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const MAX_OBJECT_BYTES = 5 * 1024 ** 3 - 1; // single PUT limit; larger videos need multipart (see README)

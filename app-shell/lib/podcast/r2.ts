import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.R2_BUCKET!;
export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const putMp3 = (key: string, body: Uint8Array) =>
  r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'audio/mpeg', CacheControl: 'private, max-age=31536000' }));

/** Short-lived signed GET. R2 serves Range requests itself, which podcast apps need for seeking. */
export const signedMp3Url = (key: string, seconds = 900) =>
  getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key, ResponseContentType: 'audio/mpeg' }), { expiresIn: seconds });

/**
 * Get a screenshot / infographic ready for Claude's vision input.
 *
 * Facts this relies on (Anthropic vision docs):
 *  - supported: JPEG, PNG, GIF (first frame only), WebP; max 8000x8000 px; max 10 MB per image when base64-encoded
 *    (so we keep the RAW file under 7 MB: base64 adds a third).
 *  - Claude 4.7 and later read up to 2576 px on the long edge (max 4784 visual tokens, 28x28 px patches);
 *    anything bigger is downscaled by the API anyway, so resizing here saves upload time without losing detail.
 *  - lossy compression can make small text unreadable, so PNG is kept when it fits and JPEG starts at high quality.
 *  - images under about 200 px on a side degrade quality: we warn instead of failing.
 *
 * sharp drops EXIF metadata (including GPS) on re-encode: the model never sees where a photo was taken.
 */
import sharp from 'sharp';

export type ImageErrorCode = 'too_large' | 'unsupported' | 'corrupt';

export class ImageError extends Error {
  code: ImageErrorCode;
  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
  }
}

export interface ImageOptions {
  /** Default 2576: the long-edge limit of the high-resolution tier (Claude 4.7 and later). */
  maxLongEdge?: number;
  /** Raw bytes after re-encoding. Default 7,000,000 (about 9.3 MB as base64, under the 10 MB limit). */
  maxRawBytes?: number;
  /** Reject uploads bigger than this before decoding anything. Default 25 MB. */
  maxInputBytes?: number;
}

export interface PreparedImage {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  resized: boolean;
  /** ceil(w/28) * ceil(h/28), the visual-token cost from the docs (an estimate: the API's own count is in `usage`). */
  estimatedTokens: number;
  warnings: string[];
}

const MAX_VISUAL_TOKENS = 4784;

function open(input: Uint8Array): sharp.Sharp {
  // limitInputPixels guards against "decompression bombs" (a tiny file that expands to gigabytes of pixels)
  return sharp(input, { limitInputPixels: 100_000_000, failOn: 'error' });
}

export async function prepareImage(input: Uint8Array, options: ImageOptions = {}): Promise<PreparedImage> {
  const maxLongEdge = options.maxLongEdge ?? 2576;
  const maxRawBytes = options.maxRawBytes ?? 7_000_000;
  const maxInputBytes = options.maxInputBytes ?? 25_000_000;

  if (input.byteLength === 0) throw new ImageError('corrupt', 'The image is empty');
  if (input.byteLength > maxInputBytes) throw new ImageError('too_large', `The image is larger than ${Math.round(maxInputBytes / 1e6)} MB`);

  let meta: sharp.Metadata;
  try {
    meta = await open(input).metadata();
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/pixel limit|exceeds/i.test(message)) throw new ImageError('too_large', 'The image has too many pixels');
    throw new ImageError('corrupt', 'The file is not a readable image');
  }
  if (meta.format === 'svg' || !meta.width || !meta.height) throw new ImageError('unsupported', 'Unsupported image type');

  // EXIF orientation 5-8 means the stored width/height are swapped relative to what people see
  const swapped = (meta.orientation ?? 1) >= 5;
  const srcW = swapped ? meta.height : meta.width;
  const srcH = swapped ? meta.width : meta.height;

  const warnings: string[] = [];
  if (Math.min(srcW, srcH) < 200) warnings.push('very_small_image');

  const encode = async (edge: number, format: 'png' | 'jpeg', quality: number): Promise<{ buf: Buffer; w: number; h: number }> => {
    let pipeline = open(input).rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
    pipeline = format === 'png' ? pipeline.png({ compressionLevel: 9 }) : pipeline.flatten({ background: '#ffffff' }).jpeg({ quality });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buf: data, w: info.width, h: info.height };
  };

  let edge = Math.min(maxLongEdge, Math.max(srcW, srcH));
  const prefersPng = meta.format === 'png' || meta.format === 'webp' || meta.format === 'gif';

  try {
    // 1) PNG first when the source was lossless: text stays crisp
    // 2) otherwise JPEG at falling quality, then shrink the picture and try again
    for (let round = 0; round < 6; round++) {
      const attempts: Array<['png' | 'jpeg', number]> = round === 0 && prefersPng ? [['png', 0], ['jpeg', 92], ['jpeg', 85]] : [['jpeg', 92], ['jpeg', 85], ['jpeg', 75]];
      for (const [format, quality] of attempts) {
        const { buf, w, h } = await encode(edge, format, quality);
        if (buf.byteLength <= maxRawBytes) {
          const resized = w !== srcW || h !== srcH;
          if (resized) warnings.push('resized');
          return {
            base64: buf.toString('base64'),
            mediaType: format === 'png' ? 'image/png' : 'image/jpeg',
            width: w,
            height: h,
            bytes: buf.byteLength,
            resized,
            estimatedTokens: Math.min(Math.ceil(w / 28) * Math.ceil(h / 28), MAX_VISUAL_TOKENS),
            warnings,
          };
        }
      }
      edge = Math.floor(edge * 0.8);
      if (edge < 600) break;
    }
  } catch (err) {
    if (err instanceof ImageError) throw err;
    throw new ImageError('corrupt', 'The image could not be processed');
  }
  throw new ImageError('too_large', 'The image is too large even after shrinking it');
}

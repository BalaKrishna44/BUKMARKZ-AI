import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { ImageError, prepareImage } from '../src/images.ts';

const solid = (w: number, h: number, channels: 3 | 4 = 3) => sharp({ create: { width: w, height: h, channels, background: { r: 30, g: 120, b: 200, alpha: channels === 4 ? 0.5 : 1 } } });

describe('prepareImage', () => {
  it('keeps a small PNG as PNG and reports the documented token cost (1000x1000 = 1296)', async () => {
    const png = await solid(1000, 1000).png().toBuffer();
    const out = await prepareImage(png);
    assert.equal(out.mediaType, 'image/png');
    assert.equal(out.resized, false);
    assert.equal(out.estimatedTokens, 1296);
  });

  it('200x200 costs 64 tokens and a very small image gets a warning, not an error', async () => {
    const out = await prepareImage(await solid(200, 200).png().toBuffer());
    assert.equal(out.estimatedTokens, 64);
    const tiny = await prepareImage(await solid(120, 80).png().toBuffer());
    assert.ok(tiny.warnings.includes('very_small_image'));
  });

  it('shrinks anything over 2576 px on the long edge, keeping the aspect ratio', async () => {
    const out = await prepareImage(await solid(6000, 3000).png().toBuffer());
    assert.equal(out.width, 2576);
    assert.equal(out.height, 1288);
    assert.equal(out.resized, true);
    assert.ok(out.estimatedTokens <= 4784);
  });

  it('falls back to JPEG and shrinks until the file fits the byte limit', async () => {
    const noise = await sharp(randomBytes(2000 * 1500 * 3), { raw: { width: 2000, height: 1500, channels: 3 } }).png().toBuffer();
    const out = await prepareImage(noise, { maxRawBytes: 1_500_000, maxInputBytes: 100_000_000 });
    assert.equal(out.mediaType, 'image/jpeg');
    assert.ok(out.bytes <= 1_500_000, `got ${out.bytes} bytes`);
    assert.equal(Buffer.from(out.base64, 'base64').byteLength, out.bytes);
  });

  it('applies EXIF rotation and strips the metadata', async () => {
    const withExif = await solid(100, 50).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await prepareImage(withExif);
    assert.equal(out.width, 50); // rotated: now portrait
    assert.equal(out.height, 100);
    const meta = await sharp(Buffer.from(out.base64, 'base64')).metadata();
    assert.equal(meta.exif, undefined);
  });

  it('rejects cleanly when no format can fit under the byte limit', async () => {
    const png = await solid(3000, 3000, 4).png().toBuffer();
    const out = await prepareImage(png, { maxRawBytes: 2_000 }).catch((e) => e);
    assert.ok(out instanceof ImageError); // far too small a limit: rejected cleanly rather than crashing
    assert.equal(out.code, 'too_large');
  });

  it('rejects empty, corrupt, SVG and oversized input with a typed error', async () => {
    await assert.rejects(prepareImage(new Uint8Array()), (e: any) => e instanceof ImageError && e.code === 'corrupt');
    await assert.rejects(prepareImage(Buffer.from('definitely not an image')), (e: any) => e instanceof ImageError && e.code === 'corrupt');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await assert.rejects(prepareImage(svg), (e: any) => e instanceof ImageError && e.code === 'unsupported');
    await assert.rejects(prepareImage(await solid(100, 100).png().toBuffer(), { maxInputBytes: 100 }), (e: any) => e instanceof ImageError && e.code === 'too_large');
  });
});

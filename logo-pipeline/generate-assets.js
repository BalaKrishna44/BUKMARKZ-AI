#!/usr/bin/env node
/**
 * Bukmarkz brand asset pipeline.
 *
 *   node generate-assets.js [--out public/assets] [--extension-dir ../extension/icons]
 *
 * Writes:
 *   <out>/logo.svg, logo-mark.svg, logo-mono.svg           vector masters
 *   <out>/icons/icon-{16,32,48,128,512}.png                 extension + general app icons
 *   <out>/icons/icon-maskable-512.png, icon-192.png         PWA / Android
 *   <out>/favicon/favicon.ico (16,32,48), favicon.svg, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png
 *   <out>/social/og-image.png (1200x630), twitter-card.png (1200x600)
 *   --extension-dir: also copies icon-16/32/48/128 there (the names the Chrome manifest expects)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

/* ------------------------------------------------------------------ brand */
const BRAND = {
  amberLight: '#ffd27a',
  amber: '#fca311',
  amberDeep: '#e08600',
  navy: '#14213d',
  navyLight: '#26407a',
  night: '#05070d',
  white: '#ffffff',
  name: 'Bukmarkz',
  tag: 'AI',
  tagline: 'Save it once. Find it by meaning.',
  font: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif",
};

/* ------------------------------------------------------------ 1. the logo */
/**
 * The mark lives on a 512x512 canvas: an amber gradient tile, a navy bookmark, and a four-point AI
 * spark that interlocks with it. The interlock is a mask: the bookmark is cut away around the spark
 * so the two shapes look threaded through each other.
 *
 * `variant`:
 *   'full'    tile + glyphs                    (logo.svg, large icons)
 *   'simple'  tile + larger glyphs, no accent  (16/32 px, where detail turns to mush)
 *   'mark'    glyphs only, transparent bg      (logo-mark.svg)
 *   'mono'    one colour, transparent bg       (logo-mono.svg, print/embossing)
 *   'bleed'   full-bleed tile, glyphs inset    (maskable icons: Android crops to a circle)
 */
function logoSvg({ variant = 'full', size = 512, mono = '#14213d' } = {}) {
  const simple = variant === 'simple';
  const glyphScale = variant === 'bleed' ? 0.7 : 1;
  const tile = variant === 'full' || variant === 'simple' || variant === 'bleed';
  const isMono = variant === 'mono';
  const radius = variant === 'bleed' ? 0 : 112;

  // Bookmark: rounded top corners, V-notch at the bottom.
  const bm = 'M150 124a28 28 0 0 1 28-28h120a28 28 0 0 1 28 28v296l-88-72-88 72Z';
  // AI spark: a four-point star built from four concave curves around its centre.
  const spark = (cx, cy, r, pinch = 0.16) => {
    const k = r * pinch;
    return `M${cx} ${cy - r}C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy}` +
      `C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r}` +
      `C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy}` +
      `C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
  };
  const sx = 326, sy = 300, sr = simple ? 112 : 104;
  const gap = 22; // width of the cut-away "thread" around the spark

  const bookmarkFill = isMono ? mono : 'url(#bk-navy)';
  const sparkFill = isMono ? mono : tile ? 'url(#bk-spark)' : 'url(#bk-amber)';

  const defs = isMono ? '' : `
  <defs>
    <linearGradient id="bk-tile" x1="64" y1="0" x2="448" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${BRAND.amberLight}"/><stop offset=".45" stop-color="${BRAND.amber}"/><stop offset="1" stop-color="${BRAND.amberDeep}"/>
    </linearGradient>
    <linearGradient id="bk-navy" x1="150" y1="96" x2="326" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${BRAND.navyLight}"/><stop offset="1" stop-color="${BRAND.navy}"/>
    </linearGradient>
    <linearGradient id="bk-spark" x1="${sx - sr}" y1="${sy - sr}" x2="${sx + sr}" y2="${sy + sr}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fff0cc"/>
    </linearGradient>
    <linearGradient id="bk-amber" x1="${sx - sr}" y1="${sy - sr}" x2="${sx + sr}" y2="${sy + sr}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${BRAND.amberLight}"/><stop offset="1" stop-color="${BRAND.amber}"/>
    </linearGradient>
  </defs>`;

  const accent = simple || isMono ? '' : `<path d="${spark(158, 168, 26, 0.2)}" fill="${tile ? '#fff3d6' : 'url(#bk-amber)'}" opacity=".95"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-labelledby="t">
  <title id="t">${BRAND.name} logo</title>${defs}
  <mask id="bk-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
    <rect width="512" height="512" fill="#fff"/>
    <path d="${spark(sx, sy, sr)}" fill="#000" stroke="#000" stroke-width="${gap * 2}" stroke-linejoin="round"/>
  </mask>
  ${tile ? `<rect width="512" height="512" rx="${radius}" fill="url(#bk-tile)"/>` : ''}
  <g transform="translate(256 256) scale(${glyphScale}) translate(-256 -256)">
    <path d="${bm}" fill="${bookmarkFill}" mask="url(#bk-cut)"/>
    <path d="${spark(sx, sy, sr)}" fill="${sparkFill}"/>
    ${accent}
  </g>
</svg>
`;
}

/* ----------------------------------------------------- social preview art */
function ogSvg(width, height) {
  // Reuse the logo's drawing instructions; its viewBox is 512, so scale it to the size we want.
  const full = logoSvg({ variant: 'full' });
  const inner = full.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title[^>]*>.*?<\/title>/, '');
  const markSize = 300, scale = markSize / 512;
  const left = 96, top = (height - markSize) / 2, textX = left + markSize + 56;
  const mid = height / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="22%" cy="30%" r="75%"><stop offset="0" stop-color="#1b2a52"/><stop offset=".55" stop-color="#0b1020"/><stop offset="1" stop-color="${BRAND.night}"/></radialGradient>
    <radialGradient id="beam" cx="85%" cy="0%" r="60%"><stop offset="0" stop-color="${BRAND.amber}" stop-opacity=".20"/><stop offset="1" stop-color="${BRAND.amber}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M56 0H0V56" fill="none" stroke="#ffffff" stroke-opacity=".05"/></pattern>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="${BRAND.amber}" flood-opacity=".35"/></filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <rect width="${width}" height="${height}" fill="url(#beam)"/>
  <g transform="translate(${left} ${top}) scale(${scale})" filter="url(#drop)">${inner}</g>
  <text x="${textX}" y="${mid - 8}" font-family="${BRAND.font}" font-size="104" font-weight="800" letter-spacing="-3" fill="#fff">${BRAND.name} <tspan fill="${BRAND.amber}">${BRAND.tag}</tspan></text>
  <text x="${textX + 4}" y="${mid + 52}" font-family="${BRAND.font}" font-size="36" font-weight="500" fill="#a4aecb">${BRAND.tagline}</text>
  <text x="${textX + 4}" y="${mid + 128}" font-family="${BRAND.font}" font-size="28" font-weight="600" fill="${BRAND.amber}">bukmarkz.com</text>
</svg>`;
}

/* -------------------------------------------------------------------- ICO */
/** Packs PNG buffers into an .ico (PNG-in-ICO, supported by every current browser and Windows). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = []; const data = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    dir.push(e); data.push(png); offset += png.length;
  }
  return Buffer.concat([header, ...dir, ...data]);
}

/* ------------------------------------------------------------------ build */
function parseArgs(argv) {
  const args = { out: path.join('public', 'assets'), extensionDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--extension-dir') args.extensionDir = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[^\n]*\n/, '')); process.exit(0); }
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return args;
}

const written = [];
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  written.push(file);
}

/** Rasterise at 4x then downscale with Lanczos: smooth edges even at 16 px. */
async function png(svg, size, { opaque = false } = {}) {
  const density = 72 * Math.max(1, Math.ceil((size * 4) / 512));
  const big = await sharp(Buffer.from(svg), { density }).resize(size * 4, size * 4).png().toBuffer();
  let img = sharp(big).resize(size, size, { kernel: 'lanczos3' });
  if (opaque) img = img.flatten({ background: BRAND.amber }); // Apple and Android masks want no transparency
  return img.png({ compressionLevel: 9 }).toBuffer();
}

async function main() {
  const { out, extensionDir } = parseArgs(process.argv.slice(2));
  const root = path.resolve(out);

  // vector masters
  write(path.join(root, 'logo.svg'), logoSvg({ variant: 'full' }));
  write(path.join(root, 'logo-mark.svg'), logoSvg({ variant: 'mark' }));
  write(path.join(root, 'logo-mono.svg'), logoSvg({ variant: 'mono' }));

  // app icons (the small ones use the simplified glyph)
  const iconPngs = {};
  for (const size of [16, 32, 48, 128, 512]) {
    const svg = logoSvg({ variant: size <= 32 ? 'simple' : 'full' });
    iconPngs[size] = await png(svg, size);
    write(path.join(root, 'icons', `icon-${size}.png`), iconPngs[size]);
  }
  write(path.join(root, 'icons', 'icon-192.png'), await png(logoSvg({ variant: 'full' }), 192));
  write(path.join(root, 'icons', 'icon-maskable-512.png'), await png(logoSvg({ variant: 'bleed' }), 512, { opaque: true }));

  // favicons
  write(path.join(root, 'favicon', 'favicon.svg'), logoSvg({ variant: 'simple', size: 64 }));
  write(path.join(root, 'favicon', 'favicon-16x16.png'), iconPngs[16]);
  write(path.join(root, 'favicon', 'favicon-32x32.png'), iconPngs[32]);
  write(path.join(root, 'favicon', 'apple-touch-icon.png'), await png(logoSvg({ variant: 'bleed' }).replace(/scale\(0\.7\)/, 'scale(0.82)'), 180, { opaque: true })); // iOS rounds the corners itself
  write(path.join(root, 'favicon', 'favicon.ico'), buildIco([{ size: 16, png: iconPngs[16] }, { size: 32, png: iconPngs[32] }, { size: 48, png: iconPngs[48] }]));

  // social previews
  for (const [name, w, h] of [['og-image', 1200, 630], ['twitter-card', 1200, 600]]) {
    write(path.join(root, 'social', `${name}.png`), await sharp(Buffer.from(ogSvg(w, h)), { density: 144 }).resize(w, h).flatten({ background: BRAND.night }).png({ compressionLevel: 9 }).toBuffer());
  }

  // Chrome extension: copy the sizes its manifest names
  if (extensionDir) {
    for (const size of [16, 32, 48, 128]) write(path.join(path.resolve(extensionDir), `icon-${size}.png`), iconPngs[size]);
  }

  // verify what we wrote
  let bad = 0;
  console.log('\nBukmarkz assets\n');
  for (const file of written) {
    const bytes = fs.statSync(file).size;
    let dims = '';
    if (file.endsWith('.png')) {
      const m = await sharp(file).metadata();
      dims = `${m.width}x${m.height}${m.hasAlpha ? ' alpha' : ''}`;
      const want = /icon-(\d+)\.png$|icon-maskable-(\d+)\.png$/.exec(file);
      if (want && m.width !== Number(want[1] || want[2])) { bad++; dims += '  <-- WRONG SIZE'; }
    } else if (file.endsWith('.svg')) {
      if (!/^<svg[\s\S]*<\/svg>\s*$/.test(fs.readFileSync(file, 'utf8'))) { bad++; dims = '<-- NOT VALID SVG'; }
    }
    console.log(`  ${path.relative(process.cwd(), file).padEnd(46)} ${String(bytes).padStart(7)} B  ${dims}`);
  }
  console.log(`\n${written.length} files written${bad ? `, ${bad} PROBLEM(S)` : ', all checked'}.`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });

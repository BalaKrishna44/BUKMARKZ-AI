/** Splits text into pieces <= max chars on sentence boundaries (TTS endpoints cap input length). */
export function chunkText(text: string, max = 3800): string[] {
  const out: string[] = []; let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const sentence of text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]) {
    if (sentence.length > max) {                      // pathological sentence: hard split on spaces
      push();
      for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max).trim());
      continue;
    }
    if (cur.length + sentence.length > max) push();
    cur += sentence;
  }
  push();
  return out;
}

/** Skip a leading ID3v2 tag. Concatenated MP3s only play cleanly if the tags of later segments are removed. */
export function stripId3v2(b: Uint8Array): Uint8Array {
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    return b.subarray(10 + size + ((b[5] & 0x10) ? 10 : 0));
  }
  return b;
}

export function concatMp3(parts: Uint8Array[]): Uint8Array {
  const clean = parts.map((p, i) => (i === 0 ? p : stripId3v2(p)));
  const out = new Uint8Array(clean.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of clean) { out.set(p, o); o += p.length; }
  return out;
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Exact duration by walking MPEG Layer III frame headers (works for CBR and VBR). Returns whole seconds. */
export function mp3DurationSec(buf: Uint8Array): number {
  let i = stripId3v2(buf) === buf ? 0 : buf.length - stripId3v2(buf).length;
  let samples = 0, rate = 44100;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3;
    const br = buf[i + 2] >> 4, sr = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { i++; continue; }
    rate = RATES[ver][sr];
    const kbps = (ver === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[br];
    const spf = ver === 3 ? 1152 : 576;
    const len = Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / rate) + pad;
    if (len < 4) { i++; continue; }
    samples += spf; i += len;
  }
  return Math.round(samples / rate);
}

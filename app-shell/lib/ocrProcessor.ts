/**
 * OCR screenshot processor: image (file / bytes / base64) -> searchable text + receipt fields -> oneclist_items.
 *
 * Engine chain (first usable result wins, every failure falls through to the next):
 *   1. Gemini Flash   (needs GEMINI_API_KEY; model via GEMINI_MODEL, default gemini-2.5-flash — 1.5 Flash has been retired)
 *   2. Claude Vision  (needs ANTHROPIC_API_KEY)
 *   3. Tesseract.js   (local, free, no API key; plain text + regex receipt heuristics)  ->  npm i tesseract.js
 * Cloud engines reuse lib/vision/providers (structured tool/JSON output, prompt-injection-hardened system prompt) and
 * lib/vision/schema (zod validation + arithmetic reconcile). Tesseract is the safety net, so the feature still works
 * when keys are missing, quotas are hit, or a provider is down.
 *
 * PRIVACY: images go to a third-party API on cloud engines. Use engines:['tesseract'] (or OCR_ENGINES=tesseract) for
 * images that must not leave your server. Images are processed in memory and never stored; only text and fields are.
 *
 * Column: the existing search column is `oneclist_items.ocr_extracted_text` (migration 004 — already inside the weighted
 * tsvector and the embedding input). A second `ocr_text` column would NOT surface in search, so we write to the existing
 * one. Change OCR_COLUMN if you really want a different name (and add it to the tsvector).
 */
import { sniffImage } from './vision/image';

export const OCR_COLUMN = 'ocr_extracted_text';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;           // Anthropic's per-image limit; resize large screenshots on the client first
export const MAX_TEXT_CHARS = 100_000;                    // keeps the tsvector (and embedding input) bounded

export type EngineName = 'gemini' | 'claude' | 'tesseract';
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export type OcrErrorCode = 'bad_input' | 'too_large' | 'unsupported_image' | 'all_engines_failed' | 'no_text_found' | 'db_error' | 'not_found';
export type FailureKind = 'timeout' | 'rate_limited' | 'auth' | 'bad_response' | 'network' | 'unavailable' | 'error';

export class OcrError extends Error {
  constructor(public code: OcrErrorCode, public attempts: Attempt[] = [], message?: string) { super(message ?? code); }
}

export interface ReceiptFields { merchant_name: string | null; total_amount: number | null; currency: string | null; date: string | null }
export interface Attempt { engine: EngineName; ok: boolean; ms: number; failure?: FailureKind }
export interface OcrResult {
  text: string;
  docType: 'receipt' | 'invoice' | 'business_card' | 'whiteboard' | 'document' | 'other';
  /** Present when the image looks like a receipt or invoice. Missing fields are null, never guessed. */
  receipt: ReceiptFields | null;
  confidence: number;                         // 0..1
  engine: EngineName;
  warnings: string[];
  attempts: Attempt[];
  /** Full structured extraction from a cloud engine (line items, tax, contact...). null for Tesseract. */
  doc: Record<string, unknown> | null;
}

/** What an engine hands back before we normalise it. */
export interface RawOcr { text: string; confidence: number; docType?: OcrResult['docType']; receipt?: Partial<ReceiptFields>; warnings?: string[]; doc?: Record<string, unknown> | null }
export type Engine = (image: Uint8Array, mime: ImageMime, ctx: { signal: AbortSignal; lang: string }) => Promise<RawOcr>;

// ───────────────────────────── input handling ─────────────────────────────

export type ImageInput = Uint8Array | ArrayBuffer | Blob | string;

/** Accepts bytes, ArrayBuffer, File/Blob, a raw base64 string, base64url, or a data: URL. */
export async function toBytes(input: ImageInput, maxBytes = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    const s = input.trim();
    const b64 = (s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!b64 || b64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new OcrError('bad_input', [], 'not valid base64');
    if (b64.length * 0.75 > maxBytes * 1.01) throw new OcrError('too_large');          // check before allocating
    bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  } else if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (typeof Blob !== 'undefined' && input instanceof Blob) {
    if (input.size > maxBytes) throw new OcrError('too_large');
    bytes = new Uint8Array(await input.arrayBuffer());
  } else throw new OcrError('bad_input');
  if (bytes.length === 0) throw new OcrError('bad_input', [], 'empty image');
  if (bytes.length > maxBytes) throw new OcrError('too_large');
  return bytes;
}

// ───────────────────────────── receipt heuristics (pure; used for Tesseract and as a cross-check) ─────────────────────────────

const SYMBOL_CCY: [RegExp, string][] = [[/₹|\brs\.?\s*(?=\d)|\binr\b/i, 'INR'], [/€|\beur\b/i, 'EUR'], [/£|\bgbp\b/i, 'GBP'], [/¥|\bjpy\b/i, 'JPY'], [/\bcad\b|c\$/i, 'CAD'], [/\baud\b|a\$/i, 'AUD'], [/\busd\b|\$/i, 'USD']];
const RECEIPT_WORDS = /\b(receipt|invoice|subtotal|sub-total|total|amount due|balance due|grand total|gst|vat|tax|change due|cash|visa|mastercard|upi|thank you|qty|bill)\b/i;
const TOTAL_LINE = /\b(grand\s*total|total\s*(?:amount|due|payable)?|amount\s*(?:due|payable|paid)|balance\s*due|net\s*(?:amount|payable)|to\s*pay)\b/i;
const NOT_TOTAL = /\b(sub\s*-?\s*total|tax|gst|vat|discount|savings?|change|tip|points|items?)\b/i;

/** "1,234.50", "1.234,50", "1 234,50", "₹ 450" -> number. null if it isn't a plausible money amount. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,\s-]/g, '').trim().replace(/\s+/g, '');
  if (!s || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) s = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  else if (lastComma >= 0) s = /,\d{1,2}$/.test(s) && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');   // "12,50" decimal vs "1,250" thousands
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
}

const AMOUNT_AT_END = /(?:[₹$€£¥]|rs\.?|inr|usd|eur|gbp)?\s*(\d[\d,. ]*\d|\d)\s*(?:[₹$€£¥]|rs\.?|inr)?\s*$/i;

export function detectCurrency(text: string): string | null {
  const codes = /\b(INR|USD|EUR|GBP|JPY|CAD|AUD|SGD|AED|CHF)\b/.exec(text.toUpperCase());
  if (codes) return codes[1];
  for (const [re, code] of SYMBOL_CCY) if (re.test(text)) return code;
  return null;
}

/** Real calendar date -> YYYY-MM-DD, else null. */
const iso = (y: number, m: number, d: number) => {
  if (y < 1990 || y > 2100) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** dateOrder decides ambiguous 03/04/2026. India/EU = 'dmy', US = 'mdy'. An ambiguous date is reported via `ambiguous`. */
export function parseDate(text: string, dateOrder: 'dmy' | 'mdy' = 'dmy'): { date: string | null; ambiguous: boolean } {
  let m = /\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (m) { const d = iso(+m[1], +m[2], +m[3]); if (d) return { date: d, ambiguous: false }; }
  m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(text);
  if (m) {
    const a = +m[1], b = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const amb = a <= 12 && b <= 12 && a !== b;
    const [d, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : dateOrder === 'dmy' ? [a, b] : [b, a];
    const r = iso(y, mo, d); if (r) return { date: r, ambiguous: amb };
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})\b/.exec(text);
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; const r = mo ? iso(+m[3], mo, +m[1]) : null; if (r) return { date: r, ambiguous: false }; }
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(text);
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; const r = mo ? iso(+m[3], mo, +m[2]) : null; if (r) return { date: r, ambiguous: false }; }
  return { date: null, ambiguous: false };
}

export function looksLikeReceipt(text: string): boolean {
  const hits = new Set((text.match(new RegExp(RECEIPT_WORDS, 'gi')) ?? []).map((w) => w.toLowerCase()));
  const amounts = (text.match(/\d+[.,]\d{2}\b/g) ?? []).length;
  return (hits.size >= 2 && amounts >= 2) || ((hits.has("receipt") || hits.has("invoice")) && amounts >= 1);
}

export function parseReceiptText(text: string, dateOrder: 'dmy' | 'mdy' = 'dmy'): { fields: ReceiptFields; warnings: string[] } {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // merchant: first line near the top that is mostly letters and not a keyword/address/phone
  let merchant: string | null = null;
  for (const l of lines.slice(0, 8)) {
    const letters = (l.match(/\p{L}/gu) ?? []).length;
    if (l.length < 2 || l.length > 60 || letters < 3 || letters / l.length < 0.6) continue;
    if (RECEIPT_WORDS.test(l) || /^(tel|ph|phone|gstin|gst|vat|www|http|date|bill|order|invoice)\b/i.test(l) || /@/.test(l)) continue;
    merchant = l.replace(/[|_*#~=]+/g, ' ').replace(/\s+/g, ' ').trim(); break;
  }

  // total: prefer the LAST line that names a total (and is not a subtotal/tax line) and ends in an amount
  let total: number | null = null;
  for (let i = lines.length - 1; i >= 0 && total === null; i--) {
    if (!TOTAL_LINE.test(lines[i]) || NOT_TOTAL.test(lines[i].replace(TOTAL_LINE, ''))) continue;
    const here = AMOUNT_AT_END.exec(lines[i]) ?? (lines[i + 1] ? AMOUNT_AT_END.exec(lines[i + 1]) : null);       // amount sometimes wraps to the next line
    const n = here ? parseAmount(here[1]) : null;
    if (n !== null && n > 0) total = n;
  }
  if (total === null) warnings.push('total not found');

  const currency = detectCurrency(text);
  if (total !== null && !currency) warnings.push('currency not detected');
  const { date, ambiguous } = parseDate(text, dateOrder);
  if (ambiguous) warnings.push(`date is ambiguous; read as ${dateOrder === 'dmy' ? 'day/month' : 'month/day'}`);
  if (date && Date.parse(date) > Date.now() + 2 * 864e5) warnings.push('date is in the future');
  return { fields: { merchant_name: merchant, total_amount: total, currency, date }, warnings };
}

// ───────────────────────────── engines ─────────────────────────────

const withTimeout = <T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { onTimeout?.(); reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

/** Never log or return raw provider errors: they can echo request details. Reduce to a small enum. */
export function classifyFailure(e: unknown): FailureKind {
  const m = String((e as { message?: string })?.message ?? e).toLowerCase();
  if ((e as { name?: string })?.name === 'TimeoutError' || m.includes('timeout') || m.includes('aborted')) return 'timeout';
  if (/\b(429|quota|rate)\b/.test(m)) return 'rate_limited';
  if (/\b(401|403)\b|api key|unauthor|permission/.test(m)) return 'auth';
  if (/\b(5\d\d)\b|overloaded|unavailable/.test(m)) return 'unavailable';
  if (e instanceof SyntaxError || /zod|invalid|no tool call|no content|truncated|json/.test(m)) return 'bad_response';
  if (/fetch failed|econn|enotfound|network|socket/.test(m)) return 'network';
  return 'error';
}

/** Cloud engine adapter: provider -> zod validation -> arithmetic reconcile -> RawOcr. Heavy imports are lazy. */
function cloudEngine(provider: 'gemini' | 'claude'): Engine {
  return async (image, mime) => {
    const [{ geminiVision, claudeVision }, { DocSchema, reconcile }] = await Promise.all([import('./vision/providers'), import('./vision/schema')]);
    const raw = await (provider === 'gemini' ? geminiVision : claudeVision).extract(image, mime);
    const d = DocSchema.parse(raw);                                          // a schema is a request, not a guarantee
    const r = reconcile(d);
    const isFin = d.doc_type === 'receipt' || d.doc_type === 'invoice';
    return {
      text: d.transcribed_text ?? '', confidence: r.confidence, docType: d.doc_type, warnings: r.warnings, doc: { ...d, confidence: r.confidence, warnings: r.warnings },
      receipt: isFin ? { merchant_name: d.vendor ?? null, total_amount: d.total ?? null, currency: d.currency ?? null, date: d.date ?? null } : undefined,
      // keep the other fields searchable even when the model returned no transcription
      ...(d.transcribed_text ? {} : { text: [d.title, d.vendor, ...(d.line_items ?? []).map((l) => l.description), ...(d.key_takeaways ?? [])].filter(Boolean).join('\n') }),
    };
  };
}

/** Local OCR. tesseract.js downloads language data on first use (needs outbound network) unless TESSDATA_PATH points at local .traineddata files. */
const tesseractEngine: Engine = async (image, _mime, { signal, lang }) => {
  const T: any = await import('tesseract.js');
  const worker = await T.createWorker(lang, 1, process.env.TESSDATA_PATH ? { langPath: process.env.TESSDATA_PATH, gzip: false } : {});
  const kill = () => { void worker.terminate().catch(() => {}); };
  signal.addEventListener('abort', kill, { once: true });
  try {
    const { data } = await worker.recognize(Buffer.from(image));
    const text = String(data?.text ?? '').replace(/\u0000/g, '').trim();
    return { text, confidence: Math.max(0, Math.min(1, (Number(data?.confidence) || 0) / 100)) };
  } finally { signal.removeEventListener('abort', kill); await worker.terminate().catch(() => {}); }
};

export const DEFAULT_ENGINES: Record<EngineName, Engine> = { gemini: cloudEngine('gemini'), claude: cloudEngine('claude'), tesseract: tesseractEngine };

export function defaultOrder(env: Record<string, string | undefined> = process.env): EngineName[] {
  const forced = (env.OCR_ENGINES ?? '').split(',').map((s) => s.trim()).filter((s): s is EngineName => ['gemini', 'claude', 'tesseract'].includes(s));
  if (forced.length) return forced;
  const order: EngineName[] = [];
  const pref = env.VISION_PROVIDER === 'claude' ? ['claude', 'gemini'] : ['gemini', 'claude'];
  for (const p of pref as EngineName[]) if (p === 'gemini' ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY) order.push(p);
  order.push('tesseract');
  return order;
}

// ───────────────────────────── main entry ─────────────────────────────

export interface OcrOptions {
  engines?: EngineName[];                    // order to try
  implementations?: Partial<Record<EngineName, Engine>>;   // tests / custom engines
  timeoutMs?: number;                        // per engine, default 45 s (Tesseract gets 2x)
  retryTransient?: boolean;                  // one retry on 429/5xx/timeout for cloud engines (default true)
  lang?: string;                             // Tesseract language(s), e.g. 'eng' or 'eng+hin'
  dateOrder?: 'dmy' | 'mdy';
  maxBytes?: number;
  signal?: AbortSignal;
}

export async function extractText(input: ImageInput, opts: OcrOptions = {}): Promise<OcrResult> {
  const { timeoutMs = 45_000, retryTransient = true, lang = 'eng', dateOrder = 'dmy', maxBytes = MAX_IMAGE_BYTES } = opts;
  const bytes = await toBytes(input, maxBytes);
  const mime = sniffImage(bytes);                                    // from the bytes, never from a client-supplied type
  if (!mime) throw new OcrError('unsupported_image');
  const order = opts.engines?.length ? opts.engines : defaultOrder();
  const impl = { ...DEFAULT_ENGINES, ...opts.implementations };
  const attempts: Attempt[] = [];
  let best: { raw: RawOcr; engine: EngineName } | null = null;
  const lowConfidence = (r: RawOcr) => r.text.trim().length < 3;

  for (const name of order) {
    if (opts.signal?.aborted) break;
    const tries = retryTransient && name !== 'tesseract' ? 2 : 1;
    for (let n = 1; n <= tries; n++) {
      const t0 = Date.now(); const ac = new AbortController();
      opts.signal?.addEventListener('abort', () => ac.abort(), { once: true });
      try {
        const raw = await withTimeout(impl[name](bytes, mime, { signal: ac.signal, lang }), name === 'tesseract' ? timeoutMs * 2 : timeoutMs, () => ac.abort());
        const ms = Date.now() - t0;
        if (lowConfidence(raw) && !raw.receipt) { attempts.push({ engine: name, ok: false, ms, failure: 'bad_response' }); break; }   // nothing readable: try the next engine
        attempts.push({ engine: name, ok: true, ms }); best = { raw, engine: name }; break;
      } catch (e) {
        const failure = classifyFailure(e); attempts.push({ engine: name, ok: false, ms: Date.now() - t0, failure });
        if (!(['rate_limited', 'unavailable', 'timeout', 'network'] as FailureKind[]).includes(failure) || n === tries) break;
        await new Promise((r) => setTimeout(r, 400 * n + Math.random() * 200));                           // short jittered backoff, then one retry
      }
    }
    if (best) break;
  }
  if (!best) {
    const anyOk = attempts.some((a) => a.failure === 'bad_response');
    throw new OcrError(anyOk && attempts.every((a) => a.failure === 'bad_response') ? 'no_text_found' : 'all_engines_failed', attempts);
  }

  // Normalise
  const { raw, engine } = best;
  const warnings = [...(raw.warnings ?? [])];
  let text = raw.text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > MAX_TEXT_CHARS) { text = text.slice(0, MAX_TEXT_CHARS); warnings.push('text truncated'); }
  if (attempts.some((a) => !a.ok)) warnings.push(`fell back to ${engine}`);

  let docType = raw.docType ?? 'other';
  let receipt: ReceiptFields | null = null;
  const heur = looksLikeReceipt(text) ? parseReceiptText(text, dateOrder) : null;
  if (raw.receipt || docType === 'receipt' || docType === 'invoice' || heur) {
    // structured fields from the model win; the regex parser fills only gaps (never overrides)
    const m = raw.receipt ?? {};
    receipt = {
      merchant_name: clean(m.merchant_name) ?? heur?.fields.merchant_name ?? null,
      total_amount: validMoney(m.total_amount) ?? heur?.fields.total_amount ?? null,
      currency: /^[A-Z]{3}$/.test(m.currency ?? '') ? m.currency! : heur?.fields.currency ?? null,
      date: validDate(m.date) ?? heur?.fields.date ?? null,
    };
    if (heur && !raw.receipt) warnings.push(...heur.warnings);
    if (docType === 'other' || docType === 'document') docType = 'receipt';
    if (!receipt.merchant_name && !receipt.total_amount && !receipt.date) receipt = null;
  }
  return { text, docType, receipt, confidence: Math.max(0, Math.min(1, raw.confidence)), engine, warnings, attempts, doc: raw.doc ?? null };
}

const clean = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 200) : null);
const validMoney = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null);
const validDate = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s) ? s : null);

// ───────────────────────────── search indexing ─────────────────────────────

/**
 * Text that goes into the search column. A header line first, so "blue bottle receipt" or "₹450 swiggy" finds it by keyword,
 * then the full transcription. The same column feeds the embedding step, so vector search sees it after re-embedding.
 */
export function buildSearchableText(r: OcrResult): string {
  const head = r.receipt ? [r.receipt.merchant_name, r.docType, r.receipt.date, r.receipt.total_amount != null ? `${r.receipt.currency ?? ''} ${r.receipt.total_amount}`.trim() : ''].filter(Boolean).join(' ') : '';
  return [head, r.text].filter(Boolean).join('\n').slice(0, MAX_TEXT_CHARS);
}

export interface DbLike { from(table: string): any }

/**
 * Save to an EXISTING item the caller owns. Every statement filters by user_id (service-role clients bypass RLS).
 * Re-embedding: ai_status -> 'pending' unless the user marked the item private ('skipped_private'), which must stay private.
 */
export async function saveOcr(db: DbLike, userId: string, itemId: string, r: OcrResult): Promise<void> {
  const fields: Record<string, unknown> = {
    [OCR_COLUMN]: buildSearchableText(r),
    doc_type: r.receipt ? r.docType : null, doc_vendor: r.receipt?.merchant_name ?? null, doc_date: r.receipt?.date ?? null,
    doc_total: r.receipt?.total_amount ?? null, doc_currency: r.receipt?.currency ?? null,
    doc_data: { engine: r.engine, warnings: r.warnings, ...(r.doc ?? {}) }, doc_confidence: r.confidence, doc_scanned_at: new Date().toISOString(),
  };
  const run = () => db.from('oneclist_items').update(fields).eq('id', itemId).eq('user_id', userId).select('id');
  let res = await run();
  if (res.error) res = await run();                                         // one retry for a transient failure
  if (res.error) throw new OcrError('db_error');
  if (!res.data?.length) throw new OcrError('not_found');                   // wrong id or someone else's item: indistinguishable on purpose
  await db.from('oneclist_items').update({ ai_status: 'pending' }).eq('id', itemId).eq('user_id', userId).in('ai_status', ['none', 'done', 'failed']);
}

/** One call for routes: image in, searchable item out. */
export async function processScreenshot(db: DbLike, userId: string, itemId: string, input: ImageInput, opts?: OcrOptions): Promise<OcrResult> {
  const result = await extractText(input, opts);
  await saveOcr(db, userId, itemId, result);
  return result;
}

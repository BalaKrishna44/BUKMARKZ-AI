import { OcrError, buildSearchableText, classifyFailure, defaultOrder, extractText, looksLikeReceipt, parseAmount, parseDate, parseReceiptText, saveOcr, toBytes, processScreenshot, type Engine, type RawOcr } from '../lib/ocrProcessor';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };
const rej = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as OcrError; } };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const b64 = Buffer.from(PNG).toString('base64');

(async () => {
  // input handling
  ok((await toBytes(b64)).length === PNG.length, 'raw base64');
  ok((await toBytes('data:image/png;base64,' + b64.slice(0, 8) + '\n' + b64.slice(8))).length === PNG.length, 'data URL with line breaks');
  ok((await toBytes(new Blob([PNG]))).length === PNG.length && (await toBytes(PNG.buffer.slice(0) as ArrayBuffer)).length === PNG.length, 'Blob / ArrayBuffer');
  ok((await rej(toBytes('not base64!!')))?.code === 'bad_input' && (await rej(toBytes('')))?.code === 'bad_input' && (await rej(toBytes(new Uint8Array(0))))?.code === 'bad_input', 'bad input rejected');
  ok((await rej(toBytes(new Uint8Array(100), 50)))?.code === 'too_large' && (await rej(toBytes('A'.repeat(4000), 100)))?.code === 'too_large', 'size limit (also before decoding base64)');
  ok((await rej(extractText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))))?.code === 'unsupported_image', 'type sniffed from bytes (HEIC/unknown refused)');

  // amounts / dates
  ok(parseAmount('1,234.50') === 1234.5 && parseAmount('1.234,50') === 1234.5 && parseAmount('₹ 450') === 450 && parseAmount('12,50') === 12.5 && parseAmount('1,250') === 1250 && parseAmount('1 234,50') === 1234.5, 'amount formats');
  ok(parseAmount('abc') === null && parseAmount('') === null, 'non-numbers rejected');
  ok(parseDate('Date: 2026-03-07').date === '2026-03-07' && parseDate('25/12/2025').date === '2025-12-25' && parseDate('12/25/2025').date === '2025-12-25', 'unambiguous dates');
  const amb = parseDate('03/04/2026', 'dmy'); ok(amb.date === '2026-04-03' && amb.ambiguous, 'ambiguous date flagged, day/month for India');
  ok(parseDate('03/04/2026', 'mdy').date === '2026-03-04', 'US order');
  ok(parseDate('7 Mar 2026').date === '2026-03-07' && parseDate('March 7, 2026').date === '2026-03-07' && parseDate('31/02/2026').date === null, 'month names; impossible dates rejected');

  // receipt heuristics
  const R1 = `BLUE BOTTLE COFFEE\n123 Market St\nTel 555-0100\nDate: 2026-03-07 08:14\nLatte            4.50\nCroissant        3.25\nSubtotal         7.75\nTax              0.70\nTOTAL          $ 8.45\nVISA ****1234\nThank you`;
  const p1 = parseReceiptText(R1);
  ok(looksLikeReceipt(R1), 'detects receipt');
  ok(p1.fields.merchant_name === 'BLUE BOTTLE COFFEE' && p1.fields.total_amount === 8.45 && p1.fields.currency === 'USD' && p1.fields.date === '2026-03-07', 'merchant/total/currency/date');
  const R2 = `Spice Garden Restaurant\nGSTIN 29ABCDE1234F1Z5\nBill No 4471\n12/03/2026\nPaneer Tikka 280.00\nNaan 60.00\nSub Total 340.00\nGST 5% 17.00\nGrand Total ₹ 357.00\nThank you`;
  const p2 = parseReceiptText(R2);
  ok(p2.fields.merchant_name === 'Spice Garden Restaurant' && p2.fields.total_amount === 357 && p2.fields.currency === 'INR' && p2.fields.date === '2026-03-12', 'Indian bill: GST lines skipped, ₹ detected, DD/MM');
  ok(parseReceiptText('Total\n12.99').fields.total_amount === 12.99, 'amount on the next line');
  ok(parseReceiptText('Subtotal 10.00\nTax 1.00').fields.total_amount === null && parseReceiptText('Subtotal 10.00\nTax 1.00').warnings.includes('total not found'), 'subtotal/tax never mistaken for total');
  ok(!looksLikeReceipt('Meeting notes: ship the roadmap on Friday, then review 3 PRs.') && !looksLikeReceipt('Architecture diagram: client → API → DB'), 'screenshots/notes are not receipts');

  // engine chain
  const good: RawOcr = { text: 'Hello world from a screenshot of a page', confidence: 0.9 };
  const eng = (f: () => Promise<RawOcr>): Engine => async () => f();
  const boom = (m: string) => eng(async () => { throw new Error(m); });
  let calls: string[] = [];
  const track = (n: string, e: Engine): Engine => async (...a) => { calls.push(n); return e(...a); };

  { calls = []; const r = await extractText(PNG, { engines: ['gemini', 'claude', 'tesseract'], implementations: { gemini: track('g', boom('gemini 500 unavailable')), claude: track('c', eng(async () => good)), tesseract: track('t', boom('x')) } });
    ok(r.engine === 'claude' && calls.join() === 'g,g,c' && r.warnings.includes('fell back to claude'), 'transient failure retried once, then falls back to next engine'); }
  { calls = []; const r = await extractText(PNG, { engines: ['gemini', 'tesseract'], implementations: { gemini: track('g', boom('gemini 401 bad API key')), tesseract: track('t', eng(async () => good)) } });
    ok(r.engine === 'tesseract' && calls.join() === 'g,t', 'auth error is NOT retried, falls to tesseract'); }
  { const r = await extractText(PNG, { engines: ['gemini', 'tesseract'], implementations: { gemini: eng(async () => ({ text: '', confidence: 0.2 })), tesseract: eng(async () => good) } });
    ok(r.engine === 'tesseract' && r.attempts[0].failure === 'bad_response', 'empty answer counts as failure'); }
  { const e = await rej(extractText(PNG, { engines: ['gemini', 'tesseract'], retryTransient: false, implementations: { gemini: boom('secret-key-abc 500'), tesseract: boom('worker crashed') } }));
    ok(e?.code === 'all_engines_failed' && e.attempts.length === 2 && !JSON.stringify(e.attempts).includes('secret'), 'all fail -> structured error, no raw provider text'); }
  { const e = await rej(extractText(PNG, { engines: ['tesseract'], implementations: { tesseract: eng(async () => ({ text: '  ', confidence: 0 })) } })); ok(e?.code === 'no_text_found', 'blank image -> no_text_found'); }
  { const t0 = Date.now(); const r = await extractText(PNG, { engines: ['gemini', 'tesseract'], timeoutMs: 80, retryTransient: false, implementations: { gemini: eng(() => new Promise(() => {})), tesseract: eng(async () => good) } });
    ok(r.engine === 'tesseract' && r.attempts[0].failure === 'timeout' && Date.now() - t0 < 2000, 'hung engine times out and falls back'); }
  { const ac = new AbortController(); let aborted = false;
    const r = await extractText(PNG, { engines: ['gemini', 'tesseract'], timeoutMs: 50, retryTransient: false, implementations: { gemini: async (_i, _m, c) => { c.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); }, tesseract: eng(async () => good) } }); void ac;
    ok(aborted && r.engine === 'tesseract', 'timeout aborts the engine (signal)'); }

  // structured vs heuristic merge
  { const r = await extractText(PNG, { engines: ['gemini'], implementations: { gemini: eng(async () => ({ text: R1, confidence: 0.95, docType: 'receipt', receipt: { merchant_name: 'Blue Bottle', total_amount: 8.45, currency: 'USD', date: '2026-03-07' } })) } });
    ok(r.receipt?.merchant_name === 'Blue Bottle' && r.receipt.total_amount === 8.45 && r.docType === 'receipt', 'model fields win'); }
  { const r = await extractText(PNG, { engines: ['gemini'], implementations: { gemini: eng(async () => ({ text: R1, confidence: 0.9, docType: 'receipt', receipt: { merchant_name: null, total_amount: -5, currency: 'usd', date: '2026-13-45' } })) } });
    ok(r.receipt?.total_amount === 8.45 && r.receipt.currency === 'USD' && r.receipt.date === '2026-03-07' && r.receipt.merchant_name === 'BLUE BOTTLE COFFEE', 'invalid model values replaced by validated heuristics'); }
  { const r = await extractText(PNG, { engines: ['tesseract'], implementations: { tesseract: eng(async () => ({ text: R2, confidence: 0.8 })) } });
    ok(r.docType === 'receipt' && r.receipt?.total_amount === 357 && r.receipt.currency === 'INR', 'tesseract text -> receipt detected and parsed'); }
  { const r = await extractText(PNG, { engines: ['tesseract'], implementations: { tesseract: eng(async () => ({ text: 'Just some prose about a whitepaper diagram and nothing else here.', confidence: 0.8 })) } });
    ok(r.receipt === null && r.docType === 'other', 'non-receipt has receipt:null'); }
  { const r = await extractText(PNG, { engines: ['tesseract'], implementations: { tesseract: eng(async () => ({ text: 'a\u0000b\n\n\n\n\nc' + ' x'.repeat(70000), confidence: 7 })) } });
    ok(r.text.length <= 100_000 && !r.text.includes('\u0000') && r.confidence === 1 && r.warnings.includes('text truncated'), 'text cleaned, bounded; confidence clamped'); }

  // classification and order
  ok(classifyFailure(new Error('gemini 429: quota')) === 'rate_limited' && classifyFailure(new Error('anthropic 529 overloaded')) === 'unavailable' && classifyFailure(new Error('fetch failed')) === 'network' && classifyFailure(new SyntaxError('Unexpected token')) === 'bad_response', 'failure classification');
  ok(defaultOrder({}).join() === 'tesseract' && defaultOrder({ GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }).join() === 'gemini,claude,tesseract' && defaultOrder({ ANTHROPIC_API_KEY: 'k' }).join() === 'claude,tesseract' && defaultOrder({ OCR_ENGINES: 'tesseract' , GEMINI_API_KEY: 'k'}).join() === 'tesseract' && defaultOrder({ GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', VISION_PROVIDER: 'claude' }).join() === 'claude,gemini,tesseract', 'engine order from env (keys decide; tesseract always last)');

  // search text + DB
  const res = await extractText(PNG, { engines: ['tesseract'], implementations: { tesseract: eng(async () => ({ text: R1, confidence: 0.9 })) } });
  const st = buildSearchableText(res);
  ok(st.startsWith('BLUE BOTTLE COFFEE receipt 2026-03-07 USD 8.45\n') && st.includes('Croissant'), 'searchable text: header line + transcription');

  const log: any[] = [];
  const mkdb = (opts: { rows?: number; err?: boolean } = {}) => ({ from: (t: string) => { const q: any = { t, ops: [] as any[] };
    for (const m of ['update', 'eq', 'in', 'select']) q[m] = (...a: any[]) => { q.ops.push([m, ...a]); return q; };
    q.then = (res: any) => { log.push(q); res(opts.err ? { error: { message: 'x' }, data: null } : { error: null, data: Array.from({ length: opts.rows ?? 1 }, () => ({ id: 'i' })) }); };
    return q; } });
  await saveOcr(mkdb(), 'u1', 'item1', res);
  const upd = log[0].ops.find((o: any) => o[0] === 'update')[1];
  ok(upd.ocr_extracted_text === st && upd.doc_vendor === 'BLUE BOTTLE COFFEE' && upd.doc_total === 8.45 && upd.doc_currency === 'USD' && upd.doc_date === '2026-03-07' && upd.doc_type === 'receipt', 'DB update carries text and receipt fields');
  ok(log[0].ops.some((o: any) => o[0] === 'eq' && o[1] === 'user_id' && o[2] === 'u1') && log[0].ops.some((o: any) => o[0] === 'eq' && o[1] === 'id' && o[2] === 'item1'), 'update scoped to id AND user_id');
  const q2 = log[1].ops; ok(q2.find((o: any) => o[0] === 'update')[1].ai_status === 'pending' && q2.find((o: any) => o[0] === 'in')[2].join() === 'none,done,failed' && !q2.find((o: any) => o[0] === 'in')[2].includes('skipped_private'), 're-embed queued, private items never touched');
  ok((await rej(saveOcr(mkdb({ rows: 0 }), 'u1', 'x', res)))?.code === 'not_found', "someone else's / missing item -> not_found");
  log.length = 0; ok((await rej(saveOcr(mkdb({ err: true }), 'u1', 'x', res)))?.code === 'db_error' && log.length === 2, 'db error retried once then db_error');
  log.length = 0; const full = await processScreenshot(mkdb(), 'u1', 'item9', 'data:image/png;base64,' + b64, { engines: ['tesseract'], implementations: { tesseract: eng(async () => good) } });
  ok(full.engine === 'tesseract' && log.length === 2, 'processScreenshot: extract + save in one call');

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

import { randomUUID } from 'node:crypto';
import { admin, json, requireUser } from '@/lib/server';
import { pickProvider, parseDoc } from '@/lib/vision/providers';
import { reconcile, type Doc } from '@/lib/vision/schema';
import { sniffImage } from '@/lib/vision/image';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BYTES = 5 * 1024 * 1024;       // Anthropic's per-image limit; compress/resize on the client first
const DAILY_LIMIT = Number(process.env.OCR_SCANS_PER_DAY ?? 100);

/**
 * POST multipart/form-data: file (jpeg|png|webp|gif, <= 5 MB), itemId? (attach to an existing item), provider? ("claude"|"gemini")
 *
 * PRIVACY: backed-up photos are end-to-end encrypted, so the server cannot read them. This route only ever sees an
 * image the client deliberately decrypted and sent for scanning. The image is processed in memory and NOT stored;
 * only the extracted text and fields are saved.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from('oneclist_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('doc_scanned_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429);

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'file_required' }, 400);
  if (file.size === 0 || file.size > MAX_BYTES) return json({ error: 'file_size', maxBytes: MAX_BYTES }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime) return json({ error: 'unsupported_image', hint: 'Send JPEG, PNG or WebP. Convert HEIC to JPEG on the device first.' }, 415);

  const itemId = form?.get('itemId');
  if (typeof itemId === 'string' && itemId) {
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) return json({ error: 'bad_item' }, 400);
    const { data: own } = await admin.from('oneclist_items').select('id').eq('id', itemId).eq('user_id', user.id).maybeSingle();
    if (!own) return json({ error: 'item_not_found' }, 404);
  }

  let doc: Doc;
  try {
    const raw = await pickProvider(String(form?.get('provider') ?? '') || null).extract(bytes, mime);
    const parsed = parseDoc(raw);
    const r = reconcile(parsed);
    doc = { ...parsed, confidence: r.confidence, warnings: r.warnings };
  } catch (e: any) {
    return json({ error: 'extraction_failed', detail: String(e?.message ?? e).slice(0, 200) }, 502);
  }

  const title = doc.title || [doc.vendor, doc.doc_type.replace('_', ' '), doc.date].filter(Boolean).join(' · ') || 'Scanned document';
  // Searchable text: a header line (so searching "Blue Bottle receipt" works) + takeaways + full transcription.
  // ocr_extracted_text feeds the existing generated tsvector and the embedding step.
  const searchable = [
    [doc.vendor, doc.doc_type, doc.date, doc.total != null ? `${doc.currency ?? ''} ${doc.total}`.trim() : ''].filter(Boolean).join(' '),
    doc.contact ? [doc.contact.name, doc.contact.title, doc.contact.company, ...(doc.contact.emails ?? []), ...(doc.contact.phones ?? [])].filter(Boolean).join(' ') : '',
    ...(doc.key_takeaways ?? []), ...(doc.action_items ?? []), doc.transcribed_text ?? '',
  ].filter(Boolean).join('\n').slice(0, 100_000);

  const fields = {
    doc_type: doc.doc_type, doc_vendor: doc.vendor ?? null, doc_date: doc.date ?? null, doc_total: doc.total ?? null,
    doc_currency: doc.currency ?? null, doc_data: doc, doc_confidence: doc.confidence, doc_scanned_at: new Date().toISOString(),
    ocr_extracted_text: searchable,
    summary: doc.key_takeaways?.length ? doc.key_takeaways.slice(0, 3).join(' ') : undefined,
    ai_status: 'pending',                       // re-embed with the new text
  };

  if (typeof itemId === 'string' && itemId) {
    const { error } = await admin.from('oneclist_items').update(fields).eq('id', itemId).eq('user_id', user.id);
    if (error) return json({ error: 'db_error' }, 500);
    return json({ itemId, doc });
  }
  const id = randomUUID();
  const { error } = await admin.from('oneclist_items').insert({
    id, user_id: user.id, title, url: `bukmarkz://scan/${id}`, url_key: `scan/${id}`, source: 'photo_scan', status: 'bookmark', ...fields,
  });
  if (error) return json({ error: 'db_error' }, 500);
  return json({ itemId: id, doc }, 201);
}

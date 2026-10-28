import { z } from 'zod';

export const DOC_TYPES = ['receipt', 'invoice', 'business_card', 'whiteboard', 'document', 'other'] as const;

const money = z.number().finite().min(0).max(1e9);
export const DocSchema = z.object({
  doc_type: z.enum(DOC_TYPES),
  title: z.string().max(200).optional(),
  vendor: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  total: money.optional(),
  tax: money.optional(),
  payment_method: z.string().max(60).optional(),
  line_items: z.array(z.object({ description: z.string().max(200), quantity: z.number().min(0).max(1e6).optional(), amount: money })).max(100).optional(),
  contact: z.object({
    name: z.string().max(120).optional(), title: z.string().max(120).optional(), company: z.string().max(160).optional(),
    emails: z.array(z.string().max(200)).max(5).optional(), phones: z.array(z.string().max(40)).max(5).optional(),
    website: z.string().max(200).optional(), address: z.string().max(300).optional(),
  }).optional(),
  key_takeaways: z.array(z.string().max(300)).max(10).optional(),
  action_items: z.array(z.string().max(300)).max(15).optional(),
  transcribed_text: z.string().max(20000).optional(),
  confidence: z.number().min(0).max(1),
});
export type Doc = z.infer<typeof DocSchema> & { warnings?: string[] };

// Hand-written JSON Schema for the tool (kept next to the zod schema; the route validates with zod regardless).
const S = (d?: string) => ({ type: 'string', ...(d ? { description: d } : {}) });
const N = (d?: string) => ({ type: 'number', ...(d ? { description: d } : {}) });
export const DOC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    doc_type: { type: 'string', enum: [...DOC_TYPES] },
    title: S('Short descriptive title'),
    vendor: S('Merchant / company that issued the receipt or invoice'),
    date: S('Document date as YYYY-MM-DD. Omit if not visible. Do not guess the year.'),
    currency: S('ISO 4217 code, e.g. USD, INR, EUR. Omit if unclear.'),
    total: N('Final amount paid/due as a plain number, no symbols'),
    tax: N('Total tax as a plain number'),
    payment_method: S(),
    line_items: { type: 'array', items: { type: 'object', properties: { description: S(), quantity: N(), amount: N('Line total as a plain number') }, required: ['description', 'amount'] } },
    contact: { type: 'object', properties: { name: S(), title: S(), company: S(), emails: { type: 'array', items: S() }, phones: { type: 'array', items: S() }, website: S(), address: S() } },
    key_takeaways: { type: 'array', items: S('One short factual point'), description: 'Whiteboards/documents: the main points' },
    action_items: { type: 'array', items: S() },
    transcribed_text: S('All legible text, in reading order'),
    confidence: N('0-1: how sure you are the extracted fields are correct and complete'),
  },
  required: ['doc_type', 'confidence'],
};

/** Money sanity check. A model can misread a digit; line items + tax that disagree with the total are a strong signal. */
export function reconcile(d: z.infer<typeof DocSchema>): { warnings: string[]; confidence: number } {
  const warnings: string[] = []; let confidence = d.confidence;
  if (d.line_items?.length && d.total != null) {
    const sum = d.line_items.reduce((n, l) => n + l.amount, 0);
    const expected = sum + (d.tax ?? 0);
    const diff = Math.abs(expected - d.total);
    if (diff > 0.02 && diff > 0.01 * d.total) {
      warnings.push(`line items${d.tax != null ? ' + tax' : ''} add up to ${expected.toFixed(2)} but total is ${d.total.toFixed(2)}`);
      confidence = Math.min(confidence, 0.5);
    }
  }
  if (d.date) {
    const t = Date.parse(d.date);
    if (Number.isNaN(t)) { warnings.push('date is not a real calendar date'); confidence = Math.min(confidence, 0.5); }
    else if (t > Date.now() + 2 * 864e5) { warnings.push('date is in the future'); confidence = Math.min(confidence, 0.5); }
  }
  if ((d.doc_type === 'receipt' || d.doc_type === 'invoice') && d.total != null && !d.currency) warnings.push('currency not detected');
  return { warnings, confidence };
}

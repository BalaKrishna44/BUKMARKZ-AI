import { checkUrl, cleanText } from '@/lib/url';
import SaveForm from './SaveForm';

export const dynamic = 'force-dynamic';

/** Landing page for the Android share sheet (/api/vault/share-target redirects here) and for the + button.
 *  The shared link only PRE-FILLS the form; nothing is saved until the person taps Save. */
export default async function SavePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const c = checkUrl(one(sp.share_url));
  return (
    <div className="pt-2">
      <h1 className="text-[22px] font-bold tracking-tight">Save a link</h1>
      <p className="mb-4 mt-1 text-sm text-[#5b7266]">Buk will add tags and a summary after you save.</p>
      <SaveForm initialUrl={c.ok ? c.url : ''} initialTitle={cleanText(one(sp.share_title), 300)} sharedButInvalid={!!one(sp.share_url) && !c.ok} />
    </div>
  );
}

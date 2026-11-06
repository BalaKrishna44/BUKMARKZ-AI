import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { ogText, type PublicStack } from '@/lib/seo/stack-seo';

export const runtime = 'edge';
export const alt = 'Bukmarkz Stack';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await sb.rpc('get_public_stack', { p_slug: slug });
  const s = data as PublicStack | null;
  const t = s ? ogText(s) : { title: 'Bukmarkz', by: '', count: '', preview: [] as string[] };
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64, background: '#020617', color: '#e6f2ea' }}>
        <div style={{ display: 'flex', fontSize: 28, color: '#34d399' }}>Bukmarkz · Stack</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>{t.title}</div>
          <div style={{ display: 'flex', fontSize: 30, color: '#93a89b' }}>{[t.by, t.count].filter(Boolean).join(' · ')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 26, color: '#6ee7b7' }}>{t.preview.map((p, i) => <div key={i} style={{ display: 'flex' }}>• {p}</div>)}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#93a89b' }}>Follow or remix at bukmarkz.com</div>
      </div>
    ),
    size,
  );
}

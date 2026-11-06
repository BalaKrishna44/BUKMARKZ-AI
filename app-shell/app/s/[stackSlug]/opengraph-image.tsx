import { ImageResponse } from 'next/og';           // next/og is the framework's build of @vercel/og: nothing extra to install
import { getPublicStack } from '@/lib/stacks/public';
import { themeOf } from '@/lib/stacks/themes';
import { avatarDataUri, clip, titleSize } from '@/lib/stacks/og';

export const runtime = 'edge';
export const alt = 'A curated stack on Bukmarkz';
// Rendered at 2x (2400×1260, still 1.91:1) so the card is crisp on retina feeds. X and LinkedIn both accept it (<5 MB).
export const size = { width: 2400, height: 1260 };
export const contentType = 'image/png';

const S = 2;                                       // every dimension below is written at 1200×630 and scaled by S
const px = (n: number) => n * S;

/** Buk, the scholar mascot, as a round badge. Satori renders inline SVG; keep to plain shapes. */
function BukBadge({ size: d }: { size: number }) {
  return (
    <div style={{ display: 'flex', width: d, height: d, borderRadius: d / 2, background: '#fff', border: `${px(3)}px solid #2fa66a`, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <svg width={d * 0.9} height={d * 0.9} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="32" cy="42" rx="19" ry="17" fill="#0f6b3e" /><ellipse cx="32" cy="46" rx="11" ry="10" fill="#d4f3e2" />
        <circle cx="32" cy="27" r="17" fill="#1a7f4e" />
        <circle cx="25" cy="27" r="7.5" fill="#fff" /><circle cx="39" cy="27" r="7.5" fill="#fff" />
        <circle cx="25" cy="27.5" r="3.2" fill="#10261c" /><circle cx="39" cy="27.5" r="3.2" fill="#10261c" />
        <circle cx="25" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" /><circle cx="39" cy="27" r="9" fill="none" stroke="#fca311" strokeWidth="1.6" />
        <path d="M29 34l3 4 3-4z" fill="#fca311" />
        <path d="M13 14l19-8 19 8-19 8z" fill="#10261c" /><path d="M51 14v9" stroke="#fca311" strokeWidth="1.6" /><circle cx="51" cy="25" r="2" fill="#fca311" />
      </svg>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ stackSlug: string }> }) {
  const { stackSlug } = await params;
  const s = await getPublicStack(stackSlug);
  const t = themeOf(s?.theme);
  const avatar = await avatarDataUri(s?.avatar ?? null);          // null on any problem -> initial-letter fallback, never a broken card

  const title = clip(s?.title ?? 'Curated stacks, shared in one click', 90);
  const n = s?.items.length ?? 0;
  // Vertical budget: a one-line title leaves room for 3 links, a two-line title for 2, a long title for none.
  const preview = (s?.items ?? []).slice(0, title.length <= 28 ? 3 : title.length <= 68 ? 2 : 0).map((i) => clip(i.title, 46));

  const el = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: px(64), backgroundImage: `linear-gradient(135deg, ${t.from}, ${t.to})`, color: t.ink, fontFamily: 'sans-serif' }}>
      {/* top row: brand + stack count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <BukBadge size={px(64)} />
          <div style={{ marginLeft: px(16), fontSize: px(30), fontWeight: 700 }}>Bukmarkz</div>
        </div>
        {s && <div style={{ display: 'flex', padding: `${px(8)}px ${px(20)}px`, borderRadius: px(999), background: t.chip, color: t.accent, fontSize: px(24), fontWeight: 700 }}>{n} link{n === 1 ? '' : 's'}</div>}
      </div>

      {/* middle: title + first links */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: px(24), fontWeight: 700, letterSpacing: px(3), textTransform: 'uppercase', color: t.accent }}>{s ? (s.remixed_from ? 'Remixed stack' : 'Curated stack') : 'Public stacks'}</div>
        <div style={{ display: 'flex', marginTop: px(16), fontSize: px(titleSize(title.length)), fontWeight: 800, lineHeight: 1.08, letterSpacing: px(-1) }}>{title}</div>
        {preview.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: px(28) }}>
            {preview.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', fontSize: px(26), color: t.muted, marginTop: i ? px(8) : 0 }}>
                <div style={{ width: px(10), height: px(10), borderRadius: px(5), background: t.accent, marginRight: px(14) }} />{p}
              </div>
            ))}
            {n > preview.length && <div style={{ display: 'flex', marginTop: px(8), fontSize: px(24), color: t.muted, opacity: 0.8 }}>+ {n - preview.length} more</div>}
          </div>
        )}
      </div>

      {/* bottom: creator + URL */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {s && (avatar
            // eslint-disable-next-line @next/next/no-img-element -- Satori needs a plain <img>
            ? <img src={avatar} width={px(56)} height={px(56)} alt="" style={{ width: px(56), height: px(56), borderRadius: px(28), objectFit: 'cover' }} />
            : <div style={{ width: px(56), height: px(56), borderRadius: px(28), background: t.chip, color: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(28), fontWeight: 800 }}>{s.handle[0]?.toUpperCase()}</div>)}
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: s ? px(16) : 0 }}>
            <div style={{ display: 'flex', fontSize: px(22), color: t.muted }}>{!s ? 'Collect. Curate. Share.' : s.remixed_from ? `Remixed from @${s.remixed_from.handle} by` : 'Curated by'}</div>
            {s && <div style={{ display: 'flex', fontSize: px(32), fontWeight: 700 }}>@{s.handle}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', padding: `${px(14)}px ${px(26)}px`, borderRadius: px(16), background: '#2fa66a', color: '#fff', fontSize: px(26), fontWeight: 700 }}>
          {s ? `bukmarkz.com/s/${clip(s.slug, 30)}` : 'bukmarkz.com'}
        </div>
      </div>
    </div>
  );

  return new ImageResponse(el, {
    ...size,
    // Titles can be edited: let the CDN refresh hourly instead of the default one-year immutable cache.
    headers: { 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}

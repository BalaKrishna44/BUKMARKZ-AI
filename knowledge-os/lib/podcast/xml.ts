export interface EpisodeXml { id: string; title: string; description: string; publishedAt: Date; audioUrl: string; bytes: number; durationSec: number }
export interface ShowXml { title: string; description: string; link: string; selfUrl: string; imageUrl?: string; author?: string; language?: string }

// XML 1.0 forbids most control characters; one stray \x0b in an article would make the whole feed unparseable.
const BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
export const esc = (s: string) => s.replace(BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const hms = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');

export function buildPodcastXml(show: ShowXml, eps: EpisodeXml[]): string {
  const items = eps.map((e) => `    <item>
      <title>${esc(e.title)}</title>
      <description>${esc(e.description)}</description>
      <itunes:summary>${esc(e.description)}</itunes:summary>
      <pubDate>${e.publishedAt.toUTCString()}</pubDate>
      <guid isPermaLink="false">${esc(e.id)}</guid>
      <enclosure url="${esc(e.audioUrl)}" length="${Math.max(0, Math.floor(e.bytes))}" type="audio/mpeg"/>
      <itunes:duration>${hms(Math.max(0, Math.floor(e.durationSec)))}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(show.title)}</title>
    <link>${esc(show.link)}</link>
    <atom:link href="${esc(show.selfUrl)}" rel="self" type="application/rss+xml"/>
    <description>${esc(show.description)}</description>
    <language>${esc(show.language ?? 'en')}</language>
    <itunes:author>${esc(show.author ?? 'Bukmarkz')}</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <itunes:block>Yes</itunes:block>
${show.imageUrl ? `    <itunes:image href="${esc(show.imageUrl)}"/>\n` : ''}${items}
  </channel>
</rss>
`;
}

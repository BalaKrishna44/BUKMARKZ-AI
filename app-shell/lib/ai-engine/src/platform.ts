import type { Platform } from './types.ts';

const HOSTS: Array<[Platform, string[]]> = [
  ['instagram', ['instagram.com', 'instagr.am']],
  ['linkedin', ['linkedin.com', 'lnkd.in']],
  ['x', ['x.com', 'twitter.com', 't.co']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['tiktok', ['tiktok.com']],
  ['reddit', ['reddit.com', 'redd.it']],
];

/** instagram.com and www.instagram.com match; evilinstagram.com does not. */
export function detectPlatform(url: string | null | undefined): Platform | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [platform, domains] of HOSTS) {
    if (domains.some((d) => host === d || host.endsWith(`.${d}`))) return platform;
  }
  return 'web';
}

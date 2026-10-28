/**
 * Where Bukmarkz lives. Change these three values (and `host_permissions` in manifest.json)
 * if your domains differ. `scripts/build.mjs` can override them for local testing.
 */
declare const __WEB_ORIGINS__: string[] | undefined;
declare const __API_BASE__: string | undefined;
declare const __SUPABASE_URL__: string | undefined;
declare const __SUPABASE_ANON_KEY__: string | undefined;

export const WEB_ORIGINS: readonly string[] =
  typeof __WEB_ORIGINS__ !== 'undefined' ? __WEB_ORIGINS__ : ['https://www.bukmarkz.com', 'https://bukmarkz.com'];

/** The Next.js app serves /api/ingest itself, so the API lives on the web origin. */
export const API_BASE: string = (typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : WEB_ORIGINS[0]).replace(/\/+$/, '');
/**
 * Supabase project (public values only: the anon key is safe to ship, row-level security protects the data).
 * Replace the two placeholders, or set BUKMARKZ_SUPABASE_URL / BUKMARKZ_SUPABASE_ANON_KEY when building.
 */
export const SUPABASE_URL: string = (typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : 'https://YOUR_PROJECT.supabase.co').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY: string = typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : 'YOUR_SUPABASE_ANON_KEY';
/** Where "Sign in with Bukmarkz" sends the user. The site's login page must redirect signed-in users back to the app. */
export const SIGN_IN_URL = `${WEB_ORIGINS[0]}/login?source=extension`;
export const FEED_LIMIT = 500;
export const INGEST_PATH = '/api/ingest';
/** Flip to true when the server actually extracts text from images, so the menu label never over-promises. */
export const OCR_AVAILABLE = false;
export const DASHBOARD_URL = `${WEB_ORIGINS[0]}/`;

export const BRIDGE_CHANNEL = 'bukmarkz.bridge.v1';
export const EXTENSION_VERSION = '0.3.0';

export const LIMITS = {
  recentSaves: 8,
  note: 2000,
  richNote: 10_000,
  imageUrl: 2048,
  tag: 24,
  tags: 8,
  title: 100,
  description: 300,
  faviconUrl: 2048,
  bridgePayloadBytes: 8_192,
  reminderMaxDays: 365,
} as const;

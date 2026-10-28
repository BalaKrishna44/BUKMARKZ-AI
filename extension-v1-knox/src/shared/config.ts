/**
 * Where Bukmarkz lives. Change these three values (and `host_permissions` in manifest.json)
 * if your domains differ. `scripts/build.mjs` can override them for local testing.
 */
declare const __WEB_ORIGINS__: string[] | undefined;
declare const __API_BASE__: string | undefined;

export const WEB_ORIGINS: readonly string[] =
  typeof __WEB_ORIGINS__ !== 'undefined' ? __WEB_ORIGINS__ : ['https://www.bukmarkz.com', 'https://bukmarkz.com'];

export const API_BASE: string = (typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : 'https://api.bukmarkz.com').replace(/\/+$/, '');
export const DASHBOARD_URL = `${WEB_ORIGINS[0]}/`;

export const BRIDGE_CHANNEL = 'bukmarkz.bridge.v1';
export const EXTENSION_VERSION = '0.1.0';

export const LIMITS = {
  recentSaves: 8,
  note: 2000,
  tag: 24,
  tags: 8,
  title: 100,
  bridgePayloadBytes: 8_192,
  reminderMaxDays: 365,
} as const;

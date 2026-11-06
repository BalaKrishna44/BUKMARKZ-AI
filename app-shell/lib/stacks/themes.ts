// Cover themes shared by the public page, the OG image and API validation. Pure: safe in the edge runtime.
export const THEME_NAMES = ['mint', 'ocean', 'sunset', 'violet', 'midnight'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
export interface Theme { label: string; from: string; to: string; ink: string; muted: string; accent: string; chip: string; dark: boolean }

export const THEMES: Record<ThemeName, Theme> = {
  mint:     { label: 'Mint',     from: '#d4f3e2', to: '#f1f9f4', ink: '#10261c', muted: '#3c5648', accent: '#17693f', chip: 'rgba(23,105,63,.12)',  dark: false },
  ocean:    { label: 'Ocean',    from: '#cfe3ff', to: '#eef5ff', ink: '#0f1e3d', muted: '#3a4a6b', accent: '#1d4ed8', chip: 'rgba(29,78,216,.12)',  dark: false },
  sunset:   { label: 'Sunset',   from: '#ffd9c0', to: '#fff3ea', ink: '#3b1707', muted: '#6b4430', accent: '#a23506', chip: 'rgba(162,53,6,.12)',   dark: false },
  violet:   { label: 'Violet',   from: '#e2d6ff', to: '#f5f0ff', ink: '#24103f', muted: '#4f4068', accent: '#6d28d9', chip: 'rgba(109,40,217,.12)', dark: false },
  midnight: { label: 'Midnight', from: '#0c1a14', to: '#1d4a37', ink: '#eaf7f0', muted: '#b4d6c4', accent: '#6ee7a8', chip: 'rgba(110,231,168,.16)', dark: true },
};
export const isTheme = (t: unknown): t is ThemeName => typeof t === 'string' && (THEME_NAMES as readonly string[]).includes(t);
export const themeOf = (t: unknown): Theme => THEMES[isTheme(t) ? t : 'mint'];

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => { const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05);
}

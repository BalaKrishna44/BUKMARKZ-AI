import 'server-only';
import type { Locale } from '@/i18n';
import en from '@/messages/en.json';

export type Dictionary = typeof en;
// One JSON per language, loaded on demand so a visitor only downloads their own.
const loaders: Record<Locale, () => Promise<Dictionary>> = {
  en: async () => en,
  es: () => import('@/messages/es.json').then((m) => m.default),
  de: () => import('@/messages/de.json').then((m) => m.default),
  ja: () => import('@/messages/ja.json').then((m) => m.default),
  hi: () => import('@/messages/hi.json').then((m) => m.default),
};
export const getDictionary = (locale: Locale) => loaders[locale]();

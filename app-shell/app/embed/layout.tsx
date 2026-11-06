import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Widgets are duplicates of the stack page, so keep them out of search results. No nav, no providers, nothing but the page. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'strict-origin-when-cross-origin' };
export default function EmbedLayout({ children }: { children: ReactNode }) { return <>{children}</>; }

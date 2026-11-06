import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.bukmarkz.com'),
  title: { default: 'Bukmarkz: the vault that remembers your links', template: '%s · Bukmarkz' },
};
export const viewport: Viewport = { themeColor: '#020617', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-slate-950">
      <body className="min-h-screen bg-slate-950 font-sans text-slate-100 antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Coming soon · Bukmarkz' };

export default async function Soon({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const f = ((await searchParams).f ?? 'This feature').slice(0, 60);
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-4 py-10 text-center">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#1a7f4e]">Coming soon</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#10261c]">{f}</h1>
        <p className="mt-3 text-[#4b5c53]">This part of Bukmarkz is built but not switched on yet. It will appear here as soon as it is ready.</p>
        <Link href="/dashboard/overview" className="mt-6 inline-block rounded-xl bg-[#2fa66a] px-5 py-2.5 text-sm font-semibold text-[#04230f] hover:bg-[#4fbf85]">Back to overview</Link>
      </div>
    </main>
  );
}

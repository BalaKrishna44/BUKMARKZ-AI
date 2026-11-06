import type { ReactNode } from 'react';

export const btn = 'rounded-xl bg-[#2fa66a] px-4 py-2 text-sm font-semibold text-[#04230f] outline-none hover:bg-[#4fbf85] focus-visible:ring-2 focus-visible:ring-[#2fa66a] focus-visible:ring-offset-2 disabled:opacity-60';
export const btnGhost = 'rounded-xl border border-[#d8eedf] bg-white px-3 py-1.5 text-sm font-semibold text-[#1a7f4e] outline-none hover:bg-[#eaf3ed] focus-visible:ring-2 focus-visible:ring-[#2fa66a] disabled:opacity-60';
export const input = 'h-10 w-full rounded-xl border border-[#d8eedf] bg-white px-3 text-sm text-[#10261c] outline-none placeholder:text-[#66766d] focus:border-[#2fa66a] focus:ring-2 focus:ring-[#2fa66a]/30';

export function Page({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-[#10261c]">{title}</h1>
      <p className="mt-1 max-w-2xl text-[#4b5c53]">{lead}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </main>
  );
}
export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-[#d8eedf] bg-white p-5 shadow-sm">{title && <h2 className="mb-2 text-base font-bold text-[#10261c]">{title}</h2>}{children}</section>;
}
export const Note = ({ tone = 'ok', children }: { tone?: 'ok' | 'err'; children: ReactNode }) => (
  <p role={tone === 'err' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${tone === 'err' ? 'bg-rose-50 text-rose-800' : 'bg-[#eaf3ed] text-[#1a7f4e]'}`}>{children}</p>
);

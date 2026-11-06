import TiltCard, { TiltDepth } from './TiltCard';
import ParticleCanvas from './ParticleCanvas';

const ITEMS = [
  { host: 'supabase.com', title: 'Tuning HNSW parameters for pgvector', tag: 'Databases', note: 'ef_search, m and recall trade-offs.' },
  { host: 'nextjs.org', title: 'Streaming responses from route handlers', tag: 'Engineering', note: 'SSE inside platform timeouts.' },
  { host: 'figma.com', title: 'Building a dark-theme token system', tag: 'Design', note: 'Semantic colors and contrast checks.' },
  { host: 'developer.chrome.com', title: 'Manifest V3 context menus', tag: 'Engineering', note: 'Service worker menu registration.' },
  { host: 'postgresql.org', title: 'Full-text search ranking and weights', tag: 'Databases', note: 'tsvector weights with ts_rank.' },
  { host: 'raindrop.io', title: 'Moving a library between bookmark apps', tag: 'Reading list', note: 'Export formats and nested folders.' },
];

export default function Demo() {
  return (
    <main className="relative isolate min-h-screen bg-[#05070d] px-4 py-16 text-slate-100">
      <ParticleCanvas />
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-10 text-3xl font-extrabold tracking-tight">Saved items</h1>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((it) => (
            <TiltCard key={it.title} as="article" data-testid="card"
              className="rounded-2xl border border-white/10 bg-[#0d1322]/80 p-6 shadow-xl shadow-black/40 backdrop-blur">
              <TiltDepth z={26}><span className="text-xs font-semibold uppercase tracking-widest text-amber-400">{it.tag}</span></TiltDepth>
              <TiltDepth z={40}><h2 className="mt-3 text-lg font-bold leading-snug">{it.title}</h2></TiltDepth>
              <TiltDepth z={14}><p className="mt-2 text-sm text-slate-400">{it.note}</p></TiltDepth>
              <TiltDepth z={20}><p className="mt-5 text-xs text-slate-500">{it.host}</p></TiltDepth>
            </TiltCard>
          ))}
        </div>
      </div>
    </main>
  );
}

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import TiltCard, { TiltDepth } from './TiltCard';
import ParticleCanvas from './ParticleCanvas';

const ITEMS = [
  { host: 'supabase.com', title: 'Tuning HNSW parameters for pgvector', tag: 'Databases', note: 'How m, ef_construction and ef_search trade recall against speed.' },
  { host: 'nextjs.org', title: 'Streaming responses from route handlers', tag: 'Engineering', note: 'Server-sent events that stay inside platform timeouts.' },
  { host: 'figma.com', title: 'Building a dark-theme token system', tag: 'Design', note: 'Semantic colors and contrast checks for dark interfaces.' },
  { host: 'developer.chrome.com', title: 'Manifest V3 context menus', tag: 'Engineering', note: 'Registering menu items from a service worker.' },
  { host: 'postgresql.org', title: 'Full-text search ranking and weights', tag: 'Databases', note: 'Ordering results with tsvector weights and ts_rank.' },
  { host: 'raindrop.io', title: 'Moving a library between bookmark apps', tag: 'Reading list', note: 'Export formats and what happens to nested folders.' },
];

function Slider({ id, label, min, max, step, value, on }: { id: string; label: string; min: number; max: number; step: number; value: number; on: (n: number) => void }) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1">
      <label htmlFor={id} className="flex justify-between text-xs font-semibold text-slate-400"><span>{label}</span><span className="tabular-nums text-amber-400">{value}</span></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(+e.target.value)} className="h-6 w-full accent-amber-400" />
    </div>
  );
}

function App() {
  const [tilt, setTilt] = useState(12), [persp, setPersp] = useState(900), [glare, setGlare] = useState(0.3);
  const [density, setDensity] = useState(7), [link, setLink] = useState(140), [inter, setInter] = useState(true);
  return (
    <div className="relative isolate min-h-screen bg-[#05070d] px-4 py-12 text-slate-100">
      <ParticleCanvas density={density} linkDistance={link} interactive={inter} />
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Move your cursor over a card</h1>
          <p className="mt-2 max-w-xl text-slate-400">Each card tilts toward the pointer and catches a moving highlight. The field behind it links nodes that drift close; move the cursor through it and they follow.</p>
        </header>

        <section aria-label="Controls" className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-2xl border border-white/10 bg-[#0d1322]/80 p-4 backdrop-blur">
          <Slider id="tilt" label="Tilt (deg)" min={0} max={25} step={1} value={tilt} on={setTilt} />
          <Slider id="persp" label="Perspective (px)" min={300} max={2000} step={50} value={persp} on={setPersp} />
          <Slider id="glare" label="Sheen" min={0} max={0.8} step={0.05} value={glare} on={setGlare} />
          <Slider id="dens" label="Particle density" min={1} max={14} step={1} value={density} on={setDensity} />
          <Slider id="link" label="Link distance (px)" min={60} max={240} step={10} value={link} on={setLink} />
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-300">
            <input type="checkbox" checked={inter} onChange={(e) => setInter(e.target.checked)} className="h-5 w-5 accent-amber-400" /> Particles follow cursor
          </label>
        </section>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((it) => (
            <TiltCard key={it.title} as="article" maxTilt={tilt} perspective={persp} glareOpacity={glare} glare={glare > 0}
              className="rounded-2xl border border-white/10 bg-[#0d1322]/85 p-6 shadow-xl shadow-black/40 backdrop-blur">
              <TiltDepth z={26}><span className="text-xs font-semibold uppercase tracking-widest text-amber-400">{it.tag}</span></TiltDepth>
              <TiltDepth z={42}><h2 className="mt-3 text-lg font-bold leading-snug">{it.title}</h2></TiltDepth>
              <TiltDepth z={14}><p className="mt-2 text-sm leading-relaxed text-slate-400">{it.note}</p></TiltDepth>
              <TiltDepth z={22}><p className="mt-5 text-xs text-slate-500">{it.host}</p></TiltDepth>
            </TiltCard>
          ))}
        </div>
        <p className="text-xs text-slate-500">On touch screens the cards stay flat so scrolling is never hijacked. With reduced motion turned on, tilt is off and the field is a still image.</p>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

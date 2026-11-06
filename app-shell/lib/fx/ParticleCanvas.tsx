'use client';
import { useEffect, useRef } from 'react';

/**
 * ParticleCanvas: ambient field of softly glowing nodes that link when they drift close.
 *
 * Layout: the canvas is `fixed inset-0 -z-10`. Put it inside a wrapper that has `relative isolate` AND the page background
 *   (e.g. <main className="relative isolate bg-[#05070d]">). `isolate` makes the wrapper its own stacking context, so the canvas
 *   paints above the wrapper's background and below its content. Without `isolate`, an opaque background hides the canvas.
 *
 * Performance choices
 *  - Particle state lives in Float32Arrays (no per-frame objects, no GC churn).
 *  - Glow comes from ONE pre-rendered sprite drawn with drawImage; shadowBlur is never used (it is the usual 60 fps killer).
 *  - Links are found with a uniform grid (about O(n)), and stroked in 4 alpha buckets = 4 draw calls instead of one per line.
 *  - Canvas resolution is capped (dpr <= 1.5). Animation pauses when the tab is hidden or the canvas is off-screen.
 *  - Adaptive quality: if the average frame time stays above ~20 ms, the particle count is trimmed until it recovers.
 *  - prefers-reduced-motion: draws one still frame and stops.
 */

export interface ParticleCanvasProps {
  className?: string;
  /** Particles per 100,000 px² of canvas. */
  density?: number;
  /** Hard cap on particles. */
  maxParticles?: number;
  /** Distance in CSS px at which two nodes connect. */
  linkDistance?: number;
  /** Drift speed in px per second. */
  speed?: number;
  /** Node colour as "r,g,b". */
  color?: string;
  /** Secondary accent colour for a share of nodes, "r,g,b". */
  accent?: string;
  /** Nodes lean toward the cursor and link to it. */
  interactive?: boolean;
}

const BUCKETS = 4;
const NEIGH: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 1], [0, 1], [1, 1]];   // forward neighbours only: each cell pair visited once

function makeSprite(rgb: string, size = 48): HTMLCanvasElement {
  const s = document.createElement('canvas'); s.width = s.height = size;
  const g = s.getContext('2d')!; const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${rgb},1)`); grad.addColorStop(0.18, `rgba(${rgb},0.9)`);
  grad.addColorStop(0.4, `rgba(${rgb},0.22)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return s;
}

export default function ParticleCanvas({
  className = '', density = 6, maxParticles = 140, linkDistance = 130, speed = 14,
  color = '252,163,17', accent = '120,170,255', interactive = true,
}: ParticleCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current!; const ctx = canvas.getContext('2d', { alpha: true })!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sprites = [makeSprite(color), makeSprite(accent)];

    let w = 0, h = 0, dpr = 1, n = 0, target = 0;
    let x = new Float32Array(0), y = new Float32Array(0), vx = new Float32Array(0), vy = new Float32Array(0);
    let r = new Float32Array(0), kind = new Uint8Array(0);
    let rafId = 0, last = 0, visible = true, onScreen = true, ema = 16;
    const mouse = { x: -9999, y: -9999, on: false };
    // grid scratch (reused every frame)
    let cols = 0, rows = 0, head = new Int32Array(0), next = new Int32Array(0);
    let pairs = new Float32Array(0);   // [x1,y1,x2,y2,bucket] x pairCount, reused
    let pc = 0; const bucketCount = new Int32Array(BUCKETS);

    const alloc = (max: number) => {
      const grow = <T extends Float32Array | Uint8Array>(a: T, C: new (n: number) => T): T => {
        if (a.length >= max) return a; const b = new C(max); b.set(a); return b;
      };
      x = grow(x, Float32Array); y = grow(y, Float32Array); vx = grow(vx, Float32Array); vy = grow(vy, Float32Array);
      r = grow(r, Float32Array); kind = grow(kind, Uint8Array);
      next = new Int32Array(max);
      if (pairs.length < max * 8 * 5) pairs = new Float32Array(max * 8 * 5);
    };
    const spawn = (i: number, anywhere = true) => {
      x[i] = anywhere ? Math.random() * w : (Math.random() < 0.5 ? 0 : w);
      y[i] = Math.random() * h;
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.9);
      vx[i] = Math.cos(a) * s; vy[i] = Math.sin(a) * s;
      r[i] = 1.4 + Math.random() * 1.8; kind[i] = Math.random() < 0.18 ? 1 : 0;
    };

    const resize = () => {
      const b = canvas.getBoundingClientRect(); w = Math.max(1, b.width); h = Math.max(1, b.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const want = Math.min(maxParticles, Math.max(12, Math.round((w * h) / 100000 * density)));
      const prev = n; alloc(want);
      for (let i = prev; i < want; i++) spawn(i);         // keep existing particles where they are; only add new ones
      n = target = want;
      cols = Math.max(1, Math.ceil(w / linkDistance)); rows = Math.max(1, Math.ceil(h / linkDistance));
      head = new Int32Array(cols * rows);
    };

    const step = (dt: number) => {
      const lean = interactive && mouse.on;
      for (let i = 0; i < n; i++) {
        if (lean) {
          const dx = mouse.x - x[i], dy = mouse.y - y[i], d2 = dx * dx + dy * dy;
          if (d2 < 22500 && d2 > 1) { const f = (1 - Math.sqrt(d2) / 150) * 18 * dt; vx[i] += (dx / Math.sqrt(d2)) * f; vy[i] += (dy / Math.sqrt(d2)) * f; }
        }
        // gentle damping toward the base drift speed so cursor pulls fade out
        const sp = Math.hypot(vx[i], vy[i]);
        if (sp > speed * 1.6) { const k = 1 - 1.2 * dt; vx[i] *= k; vy[i] *= k; }
        x[i] += vx[i] * dt; y[i] += vy[i] * dt;
        if (x[i] < -10) x[i] = w + 10; else if (x[i] > w + 10) x[i] = -10;     // wrap: no bouncing, no clustering at walls
        if (y[i] < -10) y[i] = h + 10; else if (y[i] > h + 10) y[i] = -10;
      }
    };

    const consider = (i: number, j: number) => {
      const dx = x[i] - x[j], dy = y[i] - y[j], d2 = dx * dx + dy * dy, L2 = linkDistance * linkDistance;
      if (d2 >= L2 || pc >= pairs.length / 5) return;
      const b = Math.min(BUCKETS - 1, ((1 - d2 / L2) * BUCKETS) | 0), o = pc++ * 5;
      pairs[o] = x[i]; pairs[o + 1] = y[i]; pairs[o + 2] = x[j]; pairs[o + 3] = y[j]; pairs[o + 4] = b;
      bucketCount[b]++;
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // 1. bucket particles into the grid
      head.fill(-1);
      for (let i = 0; i < n; i++) {
        const cx = Math.min(cols - 1, Math.max(0, (x[i] / linkDistance) | 0)), cy = Math.min(rows - 1, Math.max(0, (y[i] / linkDistance) | 0));
        const c = cy * cols + cx; next[i] = head[c]; head[c] = i;
      }
      // 2. find pairs within linkDistance
      pc = 0; bucketCount.fill(0);
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        for (let i = head[cy * cols + cx]; i !== -1; i = next[i]) {
          for (let j = next[i]; j !== -1; j = next[j]) consider(i, j);
          for (let k = 0; k < 4; k++) {
            const nx = cx + NEIGH[k][0], ny = cy + NEIGH[k][1]; if (nx < 0 || nx >= cols || ny >= rows) continue;
            for (let j = head[ny * cols + nx]; j !== -1; j = next[j]) consider(i, j);
          }
        }
      }
      // 3. strokes, one path per alpha bucket
      ctx.lineWidth = 1; ctx.lineCap = 'round';
      for (let b = 0; b < BUCKETS; b++) {
        if (!bucketCount[b]) continue;
        ctx.strokeStyle = `rgba(${color},${(0.05 + (b + 0.5) * (0.26 / BUCKETS)).toFixed(3)})`;
        ctx.beginPath();
        for (let p = 0; p < pc; p++) { const o = p * 5; if (pairs[o + 4] !== b) continue; ctx.moveTo(pairs[o], pairs[o + 1]); ctx.lineTo(pairs[o + 2], pairs[o + 3]); }
        ctx.stroke();
      }
      // 4. cursor links
      if (interactive && mouse.on) {
        ctx.strokeStyle = `rgba(${accent},0.35)`; ctx.beginPath();
        for (let i = 0; i < n; i++) { const dx = x[i] - mouse.x, dy = y[i] - mouse.y; if (dx * dx + dy * dy < 16900) { ctx.moveTo(mouse.x, mouse.y); ctx.lineTo(x[i], y[i]); } }
        ctx.stroke();
      }
      // 5. glowing nodes (sprite blits)
      for (let i = 0; i < n; i++) { const s = r[i] * 7; ctx.drawImage(sprites[kind[i]], x[i] - s / 2, y[i] - s / 2, s, s); }
    };

    const loop = (t: number) => {
      rafId = 0;
      if (!visible || !onScreen) return;                      // paused; resumed by the observers below
      const dt = Math.min(0.05, (t - last) / 1000 || 0.016); const ms = t - last; last = t;
      step(dt); draw();
      // adaptive quality: sustained slow frames => trim 12% of nodes (down to 30)
      if (ms > 0 && ms < 250) ema = ema * 0.95 + ms * 0.05;
      if (ema > 20 && n > 30) { n = Math.max(30, Math.floor(n * 0.88)); ema = 16; }
      rafId = requestAnimationFrame(loop);
    };
    const start = () => { if (!rafId && !reduced.matches) { last = performance.now(); rafId = requestAnimationFrame(loop); } };
    const stop = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
    const still = () => { stop(); draw(); };

    resize(); if (reduced.matches) { draw(); } else start();

    const ro = new ResizeObserver(() => { resize(); if (reduced.matches) draw(); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? start() : stop(); });
    io.observe(canvas);
    const vis = () => { visible = !document.hidden; visible ? start() : stop(); };
    document.addEventListener('visibilitychange', vis);
    const mm = (e: PointerEvent) => { const b = canvas.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; mouse.on = e.pointerType !== 'touch'; };
    const ml = () => { mouse.on = false; };
    window.addEventListener('pointermove', mm, { passive: true });
    document.documentElement.addEventListener('pointerleave', ml);
    const rm = () => (reduced.matches ? still() : start());
    reduced.addEventListener('change', rm);

    return () => {
      stop(); ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pointermove', mm);
      document.documentElement.removeEventListener('pointerleave', ml);
      reduced.removeEventListener('change', rm);
    };
  }, [density, maxParticles, linkDistance, speed, color, accent, interactive]);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none fixed inset-0 -z-10 h-full w-full ${className}`} />;
}

# TiltCard + ParticleCanvas

Standalone client components (React 18/19, Tailwind 3.3+ or 4, no other dependencies). Both start with `'use client'` for the Next.js App Router.

```tsx
<main className="relative isolate min-h-screen bg-[#05070d]">   {/* isolate + page background on the SAME wrapper */}
  <ParticleCanvas />
  <TiltCard as="article" className="rounded-2xl border border-white/10 bg-[#0d1322]/80 p-6">
    <TiltDepth z={40}><h2>Title</h2></TiltDepth>
  </TiltCard>
</main>
```

TiltCard props: maxTilt (10), scale (1.03), perspective (900), glare (true), glareOpacity (.28), glareColor ("255,255,255"), ease (.14), invert, disabled, as.
ParticleCanvas props: density (6 per 100k px²), maxParticles (140), linkDistance (130), speed (14), color / accent ("r,g,b"), interactive.

Put `rounded-*` on the TiltCard itself: the sheen uses `rounded-[inherit]` to follow it.

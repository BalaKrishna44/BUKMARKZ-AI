# MediaCard.tsx
Polymorphic card: `link` (OG banner, favicon, domain pill), `video` (YouTube thumb, hover play, modal embed), `photo` (OCR box overlay toggle).
`<MediaCard item={...} />`, or `<MediaCard loading variant="photo" photoAspect={0.75} />` for the skeleton.
Zero CLS: card and skeleton share the same layout constants (fixed-aspect media frame + fixed-height body).
Tailwind v4 (v3 also works). No other dependencies. Mark the feed container `aria-busy` while loading.
Props: priority (first row), imageProxy(src,width), resolveFavicon(domain).
Tested (Chromium): skeleton height == card height at 280/360/480/720px, CLS 0, maxres->hq thumbnail fallback,
broken OG image -> placeholder, dialog open/Esc/close unmounts iframe, OCR box alignment (portrait, panorama), malformed boxes dropped, reduced motion.
Not tested: tsc against real @types/react, real network images, Safari.

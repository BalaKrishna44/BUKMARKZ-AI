# /demo sandbox
1. Copy `app/demo/page.tsx` into a Next.js (App Router) project at `app/demo/page.tsx`.
2. Needs only React 18+ and Tailwind (v3 or v4). No other packages, no env vars, no network.
3. `npm run dev` then open http://localhost:3000/demo
Not Next.js? Import the default export from page.tsx in any React 18 + Tailwind app.
Tested in Chromium (bundled build): Netscape parsing/categorisation, import into vault, grid/list/filter, Ask My Vault (3 models), task extraction/toggle, graph drag/select, reels, 390px no horizontal scroll. Type-checked only against a loose React shim (real @types/react unavailable offline): run `npx tsc --noEmit` once in your project.

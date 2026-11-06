# Bukmarkz frontend kit: landing, dashboard, shorts

Demo-ready Next.js 15 (App Router) + Tailwind v4 + Framer Motion + Lucide. Every page renders from mock data in `lib/demo/`, so you can run it with no backend and swap in Supabase one query at a time.

## Run it
```bash
npx create-next-app@latest bukmarkz-web --ts --tailwind --app --src-dir=false --import-alias "@/*"
cd bukmarkz-web && npm i framer-motion lucide-react
# copy this kit's app/, components/, lib/ over the generated ones (replace app/layout.tsx and app/globals.css)
npm run dev
```
Open `/` (landing), `/dashboard`, `/dashboard/shorts`. Tailwind v4 needs no config file: `globals.css` starts with `@import "tailwindcss";`.

## Route map
```
app/
├─ layout.tsx                       root layout, dark theme, metadataBase
├─ globals.css
├─ (landing)/page.tsx               /                      server component, SEO metadata, 3 small client islands
├─ (dashboard)/
│  ├─ layout.tsx                    noindex; add the auth redirect here
│  └─ dashboard/
│     ├─ page.tsx                   /dashboard             <DashboardDemo/>: sidebar + HeaderSearch + feed + Resurface
│     ├─ shorts/page.tsx            /dashboard/shorts      <ShortsFeed/>
│     └─ deals/                     /dashboard/deals       NOT in this kit (the nav and feature card link to it; build it next)
├─ switch/[tool]/page.tsx           /switch/raindrop       from switch-kit.zip (static, indexable)
├─ s/[stackSlug]/page.tsx           /s/my-stack            from stacks-social.zip (public, ISR, OG image)
└─ tools/                           /tools/health-check    free tools that bring in signups (Bookmark Health Check)
```
Route groups `(landing)` and `(dashboard)` do not appear in URLs; they exist to give each area its own layout and metadata.

## Components
| File | Kind | What it does |
|---|---|---|
| `components/brand/Mascots.tsx` | server-safe | `Buk` and `Markz` inline SVGs, decorative unless given a `title` |
| `components/landing/HeroSearchMockup.tsx` | client | Looping Ask-Your-Vault demo (typing, answer, sources). Pauses on hover/focus, static under reduced motion |
| `components/landing/FeatureGrid.tsx` | server | The six features as links |
| `components/landing/LiveSandbox.tsx` | client | Ask a made-up 8-link vault, in the browser, no account |
| `components/dashboard/HeaderSearch.tsx` | client | Search / Ask toggle, ⌘K or Ctrl K, filter chips, answer panel with sources |
| `components/dashboard/MorningResurfaceWidget.tsx` | client | Five resurfaced links (open, snooze) and a one-question recall challenge with a streak |
| `components/dashboard/ShortsFeedCard.tsx` | client | `ShortsFeedCard` (one full-height card) and `ShortsFeed` (snap container with keyboard control) |
| `components/dashboard/DashboardDemo.tsx` | client | Wires the above to the mock links |

### Props worth knowing
- `HeaderSearch`: `filterOptions`, `onChange(state)` (**must be a stable function**, such as a state setter), `ask(query) → Promise<{answer, sources[]}>` (hides the Ask toggle when omitted).
- `MorningResurfaceWidget`: `items`, `quiz`, `initialStreak`, `onItemAction(id, 'opened'|'snoozed')`, `onQuizAnswer(id, correct)`. All optional; defaults to the demo data.
- `ShortsFeedCard`: `item`, `index`, `total`, `onSaveChange`, `onShare`.

## Going live: replace the mocks
| Mock | Replace with |
|---|---|
| `LINKS` in the dashboard | `oneclist_items` for the signed-in user (RLS), summaries from the AI columns |
| `demoAsk` in `DashboardDemo` | `POST /api/ask`, returning `{ answer, sources }` from `match_oneclist_items` plus the model |
| `RESURFACE` / `QUIZ` | The real Morning Resurface kit (`resurface/components/MorningResurfaceCard.tsx` and its API); this widget is the same layout with local state |
| `SHORTS` | Saved Reel/Short items; set `embedId` (11-character YouTube id) to play inline |
| Sandbox | Keep it as is: it is deliberately a keyword demo that needs no server |

## Honest limits
- **The sandbox and the dashboard's "Ask" are keyword matching**, not a model. The page says so. The real feature uses embeddings.
- **Instagram Reels do not embed** without Instagram's own script (a third-party load and consent decision), so those cards show a poster and a "Watch on Instagram" link. YouTube Shorts embed through the privacy-enhanced domain, muted, and only while the card is on screen. Nothing loads from YouTube before then.
- Mock links point at real documentation pages and the platforms' own shorts/reels pages so no demo link is dead. The shorts' creators and titles are made up.
- The "Start free" and `/login?next=` links assume your existing login page.

## Accessibility and performance
Keyboard: ⌘/Ctrl+K focuses search; Esc clears the answer, then the text, then leaves the field; arrow keys move the shorts feed; every control has a visible focus ring. Mode, filter and save controls use `aria-pressed`; answers and toasts are `aria-live`. Animations respect `prefers-reduced-motion` (autoplay and the hero loop stop). The landing page is a server component: only the three interactive pieces ship JavaScript.

## Tests
`npx tsx test/sandbox.test.ts` (19 checks: demo search quality and mock-data integrity).

## Not included
`/dashboard/deals` and `/tools/*` are linked from the nav but not built here. `/switch/[tool]` and `/s/[stackSlug]` come from earlier kits (`switch-kit.zip`, `stacks-social.zip`).

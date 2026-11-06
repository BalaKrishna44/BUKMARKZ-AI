# pwa-kit: installable app, Android share sheet, push alerts

| File | What |
|---|---|
| `app/manifest.ts` | Web app manifest (id, scope, maskable icon, Share Target to `/api/vault/share-target`) |
| `app/api/vault/share-target/route.ts` | Pulls the link out of title/text/url, signed-out users go to login and come back. **Redirects only, never saves.** |
| `components/PWAProvider.tsx` | Registers `/sw-push.js` (production only) |
| `components/push/EnablePushButton.tsx` + `lib/push-client.ts` | Permission, subscribe, POST/DELETE to the existing `/api/push/subscribe` (price-alerts kit) |
| `public/sw-push.js` | Same worker as price-alerts (same-origin notification URLs only) |
| `public/icons/` | **You supply** `icon-192.png`, `icon-512.png`, `maskable-512.png` (keep the logo inside the central 80%) |

## Wire-up
1. Copy files in. Mount `<PWAProvider>` once in the root layout; put `<EnablePushButton />` in Settings or the Deals/alerts page.
2. Env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (the **public** half of `VAPID_PUBLIC_KEY`; public by design. Never expose `VAPID_PRIVATE_KEY`). `npm i web-push` (server side, from the price-alerts kit).
3. `next.config.ts` headers for `/sw-push.js`: `Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /`.
4. Middleware: exclude `/sw-push.js`, `/manifest.webmanifest`, `/icons/*` from auth redirects and the CSP matcher.
5. Dashboard: read `share_url` / `share_title`, **pre-fill the save modal only (no auto-save)**, then `history.replaceState(null, '', '/dashboard')`. Render values as text. Restrict `next` on `/login` to same-site paths.

## Platform reality
* Share Target: Android Chrome/Edge/Samsung Internet, **only after the PWA is installed**. iOS Safari ignores it.
* Web push on iPhone works only for a PWA added to the Home Screen (iOS 16.4+); the button explains this.
* Test with `next build && next start` over HTTPS or localhost on a real phone. `next dev` does not register the worker.
* Max 10 devices per user (enforced by `/api/push/subscribe`, returns 409).

## Tested here
`test/push-client.test.ts`: VAPID key decoding, 2/2. **Not run:** Next.js, a real browser, a phone, a push service.

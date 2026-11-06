// Canonical template lives next to the edge function so Supabase bundles it; re-exported here for `email dev` and Next.js previews.
export { default, DEFAULT_CTA } from '../supabase/functions/_shared/FridayJokeDigest';
export type { FridayJokeDigestProps, FridayTurn } from '../supabase/functions/_shared/FridayJokeDigest';

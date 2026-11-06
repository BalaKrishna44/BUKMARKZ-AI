// Canonical template lives next to the edge function so Supabase bundles it; re-exported here for `email dev` and Next.js previews.
export { default, CHECKIN_PROMPTS, pickPrompt } from '../supabase/functions/_shared/WeeklyDigestEmail';
export type { DigestRow, WeeklyDigestEmailProps } from '../supabase/functions/_shared/WeeklyDigestEmail';

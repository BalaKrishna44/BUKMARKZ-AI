import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Server-side client bound to the signed-in user's cookies (Next 15: cookies() is async; on Next 14 drop the `await`). */
export async function createClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a Server Component: middleware refreshes the session */ } },
    },
  });
}

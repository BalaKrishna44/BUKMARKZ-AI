'use client';
import { createClient } from '@/lib/supabase/client';
export default function SignOut() {
  return <button onClick={async () => { await createClient().auth.signOut(); window.location.assign('/login'); }} className="w-full rounded-2xl border border-[#d6e8dc] bg-white p-3.5 text-left text-sm font-medium text-[#b42318]">Sign out</button>;
}

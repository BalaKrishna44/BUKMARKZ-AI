import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionDeps } from './core';
import { summarizeTabs } from './summary';

/** Wires the pure core to a Supabase client that carries the USER's identity (cookie client or Bearer-token client), so RLS decides ownership. */
export function sessionDeps(db: SupabaseClient, userId: string): SessionDeps {
  return {
    site: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bukmarkz.com',
    async insert(row) {
      const { data, error } = await db.from('sessions').insert(row).select('id').single();
      return error ? { error: `${error.message} ${error.code ?? ''}` } : { id: data.id as string };
    },
    async setSummary(id, summary) { await db.from('sessions').update({ summary }).eq('id', id).eq('user_id', userId); },
    summarize: (tabs) => summarizeTabs(userId, tabs),
    defer(task) { try { after(task); } catch { void task(); } },
  };
}

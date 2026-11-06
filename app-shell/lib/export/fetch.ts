import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportCollection, ExportItem } from './serialize';

const PAGE = 1000; // Supabase caps responses at 1000 rows
const COLS = 'url,title,note,tags,collection_id,status,category,summary,action_items,remind_at,created_at';

export async function fetchCollections(sb: SupabaseClient): Promise<ExportCollection[]> {
  const out: ExportCollection[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('collections').select('id,parent_id,name').order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as ExportCollection[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Keyset-free paging ordered by (created_at, id) so pages are stable. RLS limits rows to the signed-in user. */
export async function* fetchItems(sb: SupabaseClient): AsyncGenerator<ExportItem[]> {
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('oneclist_items').select(COLS).order('created_at').order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return;
    yield data as ExportItem[];
    if (data.length < PAGE) return;
  }
}

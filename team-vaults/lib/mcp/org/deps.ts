import { admin } from '@/lib/server';
import { defaultDeps } from '@/lib/mcp/deps';
import { EMBEDDING_MODEL, type OrgDeps, type OrgItem, type OrgStore } from './tools';

/** Production wiring: Supabase service role. Every query is parameterised by the orgId from the verified token and nothing else. */
export const supabaseOrgStore: OrgStore = {
  async search(orgId, { text, embedding, limit }) {
    const { data, error } = await admin.rpc('match_org_items', {
      p_org: orgId, query_embedding: embedding ? `[${embedding.join(',')}]` : null, match_threshold: 0.2, match_count: limit,
      query_text: text, embedding_model_param: embedding ? EMBEDDING_MODEL : null,
    });
    if (error) throw new Error('search failed');
    return (data ?? []).map((r: any): OrgItem => ({
      id: r.id, org_id: r.org_id, url: r.url, title: r.title ?? '', summary: r.summary ?? null, note: r.note ?? null,
      tags: [...new Set([...(r.ai_tags ?? []), ...(r.tags ?? [])])].filter(Boolean), created_at: r.created_at, similarity: r.similarity,
    }));
  },
};
export const defaultOrgDeps = (): OrgDeps => ({ store: supabaseOrgStore, embed: defaultDeps().embed });

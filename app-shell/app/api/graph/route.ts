import { admin, json, requireUser } from '@/lib/server';
import { labelPropagation, numberClusters } from '@/lib/graph/cluster';

export const runtime = 'nodejs';

/**
 * GET /api/graph?threshold=0.8&limit=400
 * -> { nodes:[{id,label,type,url,cluster,degree}], edges:[{source,target,weight}], clusters:[{id,size,label}] }
 * Shape is what React Flow (nodes/edges) and d3-force (nodes/links) both take directly.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const q = new URL(req.url).searchParams;
  const threshold = Math.min(0.99, Math.max(0.5, Number(q.get('threshold') ?? 0.8)));
  const limit = Math.min(1000, Math.max(20, Number(q.get('limit') ?? 400)));

  // Strongest edges first; 5x limit is plenty to fill `limit` nodes.
  const { data: rows, error } = await admin.from('item_edges')
    .select('source_item_id,target_item_id,similarity_score').eq('user_id', user.id)
    .gte('similarity_score', threshold).order('similarity_score', { ascending: false }).limit(limit * 5);
  if (error) return json({ error: 'db_error' }, 500);

  const degree = new Map<string, number>();
  for (const r of rows ?? []) for (const id of [r.source_item_id, r.target_item_id]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const keep = new Set([...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id));
  const edges = (rows ?? []).filter((r) => keep.has(r.source_item_id) && keep.has(r.target_item_id))
    .map((r) => ({ source: r.source_item_id, target: r.target_item_id, weight: Number(r.similarity_score) }));
  if (!keep.size) return json({ nodes: [], edges: [], clusters: [] });

  const { data: items } = await admin.from('oneclist_items')
    .select('id,title,url,source,doc_type,tags,category').eq('user_id', user.id).in('id', [...keep]);
  const meta = new Map((items ?? []).map((i) => [i.id, i]));

  const { cluster, sizes } = numberClusters(labelPropagation([...keep], edges));
  // Name each cluster after its most common tag, else its best-connected member's title.
  const names = sizes.map((_, c) => {
    const ids = [...keep].filter((id) => cluster.get(id) === c);
    const tagCount = new Map<string, number>();
    for (const id of ids) for (const t of meta.get(id)?.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    const top = [...tagCount.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) return top[0];
    const hub = ids.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0];
    return meta.get(hub)?.title?.slice(0, 40) ?? `Cluster ${c + 1}`;
  });

  const nodes = [...keep].map((id) => {
    const m = meta.get(id);
    return {
      id, label: m?.title || m?.url || 'Untitled', url: m?.url ?? null, cluster: cluster.get(id) ?? -1, degree: degree.get(id) ?? 0,
      type: m?.doc_type ? 'document' : m?.source === 'photo_scan' ? 'photo' : m?.source === 'rss' ? 'article' : 'bookmark',
    };
  });
  return json({ nodes, edges, clusters: sizes.map((size, id) => ({ id, size, label: names[id] })) });
}

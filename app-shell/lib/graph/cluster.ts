export interface Edge { source: string; target: string; weight: number }

/**
 * Weighted label propagation: every node repeatedly adopts the label with the greatest total edge weight among its
 * neighbours. Deterministic (stable node order, ties go to the smaller label) so the same graph always yields the same
 * clusters, which keeps cluster colours from flickering between page loads. O(iterations * edges).
 */
export function labelPropagation(nodeIds: string[], edges: Edge[], maxIter = 25): Map<string, string> {
  const adj = new Map<string, { id: string; w: number }[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target) || e.source === e.target) continue;
    adj.get(e.source)!.push({ id: e.target, w: e.weight });
    adj.get(e.target)!.push({ id: e.source, w: e.weight });
  }
  const order = [...nodeIds].sort();
  const label = new Map(order.map((id) => [id, id]));
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (const id of order) {
      const votes = new Map<string, number>();
      for (const n of adj.get(id)!) votes.set(label.get(n.id)!, (votes.get(label.get(n.id)!) ?? 0) + n.w);
      if (!votes.size) continue;
      let best = label.get(id)!, bw = votes.get(best) ?? -1;
      for (const [l, w] of votes) if (w > bw + 1e-12 || (Math.abs(w - bw) <= 1e-12 && l < best)) { best = l; bw = w; }
      if (best !== label.get(id)) { label.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  return label;
}

/** Renumber labels to 0..k-1 by descending cluster size; singletons all get -1 (rendered as "unclustered"). */
export function numberClusters(label: Map<string, string>): { cluster: Map<string, number>; sizes: number[] } {
  const members = new Map<string, string[]>();
  for (const [id, l] of label) (members.get(l) ?? members.set(l, []).get(l)!).push(id);
  const groups = [...members.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  const cluster = new Map<string, number>(); const sizes: number[] = [];
  for (const id of label.keys()) cluster.set(id, -1);
  groups.forEach((g, i) => { sizes.push(g.length); for (const id of g) cluster.set(id, i); });
  return { cluster, sizes };
}

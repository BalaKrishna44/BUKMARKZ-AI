/**
 * Hybrid search: meaning (pgvector) + exact words (Postgres full-text), merged with Reciprocal Rank Fusion in SQL
 * (see search_chunks in sql/001_ai_features.sql), then relaxed if the filters were too narrow.
 */
import { resolveDateRange, safeZone } from './dates.ts';
import type { Embedder } from './embeddings.ts';
import { toPgVector } from './embeddings.ts';
import { buildTsQuery, parseQuery, type ParsedQuery, type ParseDeps } from './query-understanding.ts';
import type { LlmClient, Platform } from './types.ts';

export interface SearchHit {
  chunkId: string;
  bookmarkId: string;
  chunkIndex: number;
  content: string;
  title: string | null;
  url: string | null;
  platform: string | null;
  savedAt: Date;
  score: number;
  vecRank: number | null;
  ftsRank: number | null;
}

export interface SearchParams {
  userId: string;
  tsQuery: string | null;
  embedding: number[] | null;
  platform: Platform | null;
  from: Date | null;
  to: Date | null;
  limit: number;
}

export interface SearchStore {
  searchChunks(params: SearchParams): Promise<SearchHit[]>;
}

export interface SearchDeps {
  store: SearchStore;
  /** null = full-text only */
  embedder: Embedder | null;
  client?: LlmClient;
  model?: string;
  now?: () => Date;
  onUsage?: ParseDeps['onUsage'];
}

export interface SearchOptions {
  userId: string;
  question: string;
  /** IANA zone such as "Asia/Kolkata": decides what "last week" means for this user. */
  timezone?: string;
  limit?: number;
  /** If the filters leave fewer hits than this, they are relaxed (date first, then platform). Default 3. */
  minResults?: number;
  parsed?: ParsedQuery;
}

export interface SearchOutcome {
  hits: SearchHit[];
  parsed: ParsedQuery;
  applied: { platform: Platform | null; from: Date | null; to: Date | null };
  /** Filters that were dropped because they left too few results. Tell the user. */
  widened: Array<'date' | 'platform'>;
  degraded: Array<'fts_only' | 'heuristic_query'>;
}

export async function hybridSearch(deps: SearchDeps, opts: SearchOptions): Promise<SearchOutcome> {
  const limit = opts.limit ?? 12;
  const minResults = opts.minResults ?? 3;
  const tz = safeZone(opts.timezone);
  const now = (deps.now ?? (() => new Date()))();
  const degraded: SearchOutcome['degraded'] = [];

  const parsed = opts.parsed ?? (await parseQuery(opts.question, { client: deps.client, model: deps.model, onUsage: deps.onUsage }));
  if (parsed.source === 'heuristic' && deps.client) degraded.push('heuristic_query');

  // Meaning: if the embedding service is down we still answer from full-text instead of failing.
  let embedding: number[] | null = null;
  if (deps.embedder) {
    try {
      const [vec] = await deps.embedder.embed([parsed.semanticQuery || opts.question]);
      embedding = vec ?? null;
      if (embedding) toPgVector(embedding); // reject NaN before it reaches SQL
    } catch {
      embedding = null;
    }
  }
  if (!embedding) degraded.push('fts_only');

  const tsQuery = buildTsQuery(parsed.keywords.length ? parsed.keywords : [parsed.semanticQuery]);
  const range = parsed.dateToken ? resolveDateRange(parsed.dateToken, now, tz) : null;

  const run = (platform: Platform | null, useDate: boolean) =>
    deps.store.searchChunks({
      userId: opts.userId,
      tsQuery,
      embedding,
      platform,
      from: useDate && range ? range.from : null,
      to: useDate && range ? range.to : null,
      limit,
    });

  const widened: SearchOutcome['widened'] = [];
  let platform = parsed.platform;
  let useDate = Boolean(range);
  let hits = await run(platform, useDate);

  if (hits.length < minResults && useDate) {
    useDate = false;
    widened.push('date');
    hits = await run(platform, false);
  }
  if (hits.length < minResults && platform) {
    platform = null;
    widened.push('platform');
    hits = await run(null, false);
  }

  return { hits, parsed, applied: { platform, from: useDate && range ? range.from : null, to: useDate && range ? range.to : null }, widened, degraded };
}

/** Best chunks first, but at most `maxPerBookmark` from one bookmark and `maxBookmarks` bookmarks overall. */
export function groupByBookmark(hits: SearchHit[], maxBookmarks: number, maxPerBookmark: number): SearchHit[][] {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const g = groups.get(hit.bookmarkId);
    if (g) {
      if (g.length < maxPerBookmark) g.push(hit);
    } else if (groups.size < maxBookmarks) {
      groups.set(hit.bookmarkId, [hit]);
    }
  }
  return [...groups.values()];
}

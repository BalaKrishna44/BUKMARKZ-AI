/** Chunk a bookmark's text, embed the chunks, store them. Full-text search works even if embedding fails. */
import { buildBookmarkChunks, type BookmarkForIndex } from './chunking.ts';
import { EmbeddingError, toPgVector, type Embedder } from './embeddings.ts';

export interface IndexStore {
  getBookmarkForIndex(userId: string, bookmarkId: string): Promise<(BookmarkForIndex & { isPrivate: boolean }) | null>;
  /** Replace every chunk of this bookmark (delete + insert in one transaction). Returns the new rows. */
  replaceChunks(userId: string, bookmarkId: string, contents: string[]): Promise<Array<{ id: string; index: number; content: string }>>;
  setChunkEmbeddings(userId: string, rows: Array<{ id: string; vector: string }>): Promise<void>;
  chunksMissingEmbedding(limit: number): Promise<Array<{ id: string; userId: string; content: string }>>;
}

export interface IndexResult {
  chunks: number;
  embedded: boolean;
  skippedPrivate?: boolean;
}

export async function indexBookmark(deps: { store: IndexStore; embedder: Embedder | null }, userId: string, bookmarkId: string): Promise<IndexResult> {
  const b = await deps.store.getBookmarkForIndex(userId, bookmarkId);
  if (!b) throw new Error(`Bookmark ${bookmarkId} not found for this user`);
  // Private items are never indexed: no chunks, no embeddings (the SQL also refuses to insert them).
  if (b.isPrivate) return { chunks: 0, embedded: false, skippedPrivate: true };

  const contents = buildBookmarkChunks(b);
  const rows = await deps.store.replaceChunks(userId, bookmarkId, contents);
  if (rows.length === 0 || !deps.embedder) return { chunks: rows.length, embedded: false };

  try {
    const vectors = await deps.embedder.embed(rows.map((r) => r.content));
    await deps.store.setChunkEmbeddings(userId, rows.map((r, i) => ({ id: r.id, vector: toPgVector(vectors[i] as number[]) })));
    return { chunks: rows.length, embedded: true };
  } catch (err) {
    if (err instanceof EmbeddingError && !err.retryable) throw err; // bad key / wrong dimensions: a real bug
    return { chunks: rows.length, embedded: false }; // temporary: embedMissing() will fill the gap
  }
}

/** Repair job: embed chunks that were saved without a vector (the embedding service was down). */
export async function embedMissing(deps: { store: IndexStore; embedder: Embedder }, limit = 200): Promise<{ embedded: number; remaining: boolean }> {
  const rows = await deps.store.chunksMissingEmbedding(limit);
  if (rows.length === 0) return { embedded: 0, remaining: false };
  const vectors = await deps.embedder.embed(rows.map((r) => r.content));
  const byUser = new Map<string, Array<{ id: string; vector: string }>>();
  rows.forEach((r, i) => byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), { id: r.id, vector: toPgVector(vectors[i] as number[]) }]));
  for (const [userId, list] of byUser) await deps.store.setChunkEmbeddings(userId, list);
  return { embedded: rows.length, remaining: rows.length === limit };
}

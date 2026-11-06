/**
 * The background job for ONE newly saved bookmark. Call it from whatever queue you use (pg-boss, BullMQ, a Supabase
 * queue, a cron over ai_status = 'pending'): this file does not care.
 *
 *   social post / screenshot / transcript  -> Feature 1 (extract + index)
 *   article text                           -> Feature 2 (checklist) + index
 *
 * Each step is independent: a failed checklist doesn't undo the search index, and the reverse.
 */
import { generateChecklist, type ChecklistDeps, type ChecklistResult } from './checklist.ts';
import { indexBookmark, type IndexResult, type IndexStore } from './indexer.ts';
import type { Embedder } from './embeddings.ts';
import { processSocialPost, type SocialDeps, type SocialPostInput, type SocialResult } from './social-extractor.ts';

export interface BookmarkJob extends Omit<SocialPostInput, 'platform'> {
  platform?: SocialPostInput['platform'];
  /** plain text of an article / guide, for the checklist */
  articleText?: string;
  articleTitle?: string;
}

export interface PipelineDeps {
  social: Omit<SocialDeps, 'index'>;
  checklist: ChecklistDeps;
  indexStore: IndexStore;
  embedder: Embedder | null;
}

export interface PipelineResult {
  social?: SocialResult;
  checklist?: ChecklistResult;
  index?: IndexResult | { error: string };
}

export async function processBookmark(deps: PipelineDeps, job: BookmarkJob): Promise<PipelineResult> {
  const out: PipelineResult = {};
  const index = (userId: string, bookmarkId: string) => indexBookmark({ store: deps.indexStore, embedder: deps.embedder }, userId, bookmarkId);

  const isSocial = Boolean(job.image || job.transcript || job.caption);
  if (isSocial) {
    out.social = await processSocialPost(job, { ...deps.social, index: async (u, b) => void (await index(u, b)) });
  }

  if (job.articleText) {
    out.checklist = await generateChecklist({ userId: job.userId, bookmarkId: job.bookmarkId, title: job.articleTitle ?? '', url: job.url, text: job.articleText }, deps.checklist);
  }

  if (!isSocial) {
    try {
      out.index = await index(job.userId, job.bookmarkId);
    } catch (err) {
      out.index = { error: err instanceof Error ? err.message : 'index failed' };
    }
  }
  return out;
}

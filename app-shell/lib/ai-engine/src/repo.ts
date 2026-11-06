/**
 * Every SQL statement in the project lives here, behind the small *Store interfaces the other modules define.
 * Every query takes user_id explicitly: this code runs with a service connection that bypasses row-level security,
 * so the filter in the query IS the access control.
 */
import type { ChecklistStore, OneclistInsert } from './checklist.ts';
import type { BookmarkForIndex } from './chunking.ts';
import type { ClaimedReminder, DispatchStore } from './dispatcher.ts';
import type { IndexStore } from './indexer.ts';
import type { NotificationPayload, ReviewCandidate, SchedulerStore } from './scheduler.ts';
import type { SearchHit, SearchParams, SearchStore } from './search.ts';
import type { ExtractionPatch, SocialStore } from './social-extractor.ts';
import type { Db } from './types.ts';
import { toPgVector } from './embeddings.ts';

export class PgStore implements SocialStore, ChecklistStore, SearchStore, IndexStore, SchedulerStore, DispatchStore {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  /* ---------------------------------------------------------------- bookmarks (Features 1 and 2) */

  async getBookmark(userId: string, bookmarkId: string): Promise<{ title: string | null; isPrivate: boolean } | null> {
    const { rows } = await this.db.query<{ title: string | null; is_private: boolean }>('select title, is_private from bookmarks where id = $1 and user_id = $2', [bookmarkId, userId]);
    const r = rows[0];
    return r ? { title: r.title, isPrivate: r.is_private } : null;
  }

  async setAiStatus(userId: string, bookmarkId: string, status: 'processing' | 'done' | 'failed' | 'skipped_private', error: string | null = null): Promise<void> {
    await this.db.query(
      `update bookmarks
          set ai_status = $3::text,
              ai_error = $4::text,
              ai_attempts = case when $3::text = 'processing' then ai_attempts + 1 else ai_attempts end,
              ai_processed_at = case when $3::text <> 'processing' then now() else ai_processed_at end
        where id = $1 and user_id = $2`,
      [bookmarkId, userId, status, error],
    );
  }

  async applyExtraction(userId: string, bookmarkId: string, p: ExtractionPatch): Promise<void> {
    await this.db.query(
      `update bookmarks
          set title = coalesce(nullif(btrim(title), ''), $3),
              platform = $4,
              content_text = $5,
              summary = $6,
              tags = (select coalesce(array_agg(distinct t), '{}') from unnest(tags || $7::text[]) as t)
        where id = $1 and user_id = $2 and is_private = false`,
      [bookmarkId, userId, p.title, p.platform, p.contentText, p.summary, p.tags],
    );
  }

  async replaceAiChecklist(userId: string, bookmarkId: string, rows: OneclistInsert[]): Promise<void> {
    await this.db.tx(async (q) => {
      // Steps the user already ticked off are kept; everything else the AI wrote earlier is replaced.
      await q.query("delete from oneclist_items where bookmark_id = $1 and user_id = $2 and source = 'ai' and done_at is null", [bookmarkId, userId]);
      await q.query(
        `insert into oneclist_items (user_id, bookmark_id, title, detail, done_when, estimate_minutes, position, kind, source)
         select $1, $2, t.title, t.detail, t.done_when, t.minutes, t.pos, 'action', 'ai'
           from unnest($3::text[], $4::text[], $5::text[], $6::int[], $7::int[]) as t(title, detail, done_when, minutes, pos)
         on conflict do nothing`,
        [userId, bookmarkId, rows.map((r) => r.title), rows.map((r) => r.detail), rows.map((r) => r.done_when), rows.map((r) => r.estimate_minutes), rows.map((r) => r.position)],
      );
    });
  }

  /** Call when the user opens a bookmark. Also cancels a nudge that has not gone out yet. */
  async markBookmarkOpened(userId: string, bookmarkId: string): Promise<void> {
    await this.db.query('select mark_bookmark_opened($1::uuid, $2::uuid)', [userId, bookmarkId]);
  }

  /* ---------------------------------------------------------------- search index (Feature 3) */

  async getBookmarkForIndex(userId: string, bookmarkId: string): Promise<(BookmarkForIndex & { isPrivate: boolean }) | null> {
    const { rows } = await this.db.query(
      'select title, url, platform, tags, summary, note, content_text, is_private from bookmarks where id = $1 and user_id = $2',
      [bookmarkId, userId],
    );
    const r = rows[0];
    return r ? { title: r.title, url: r.url, platform: r.platform, tags: r.tags ?? [], summary: r.summary, note: r.note, contentText: r.content_text, isPrivate: r.is_private } : null;
  }

  async replaceChunks(userId: string, bookmarkId: string, contents: string[]): Promise<Array<{ id: string; index: number; content: string }>> {
    return this.db.tx(async (q) => {
      await q.query('delete from bookmark_chunks where bookmark_id = $1 and user_id = $2', [bookmarkId, userId]);
      if (contents.length === 0) return [];
      const { rows } = await q.query<{ id: string; chunk_index: number; content: string }>(
        `insert into bookmark_chunks (bookmark_id, user_id, chunk_index, content, platform, saved_at, is_private)
         select b.id, b.user_id, t.idx, t.content, b.platform, b.created_at, b.is_private
           from bookmarks b
          cross join unnest($3::int[], $4::text[]) as t(idx, content)
          where b.id = $1 and b.user_id = $2 and b.is_private = false
         returning id, chunk_index, content`,
        [bookmarkId, userId, contents.map((_, i) => i), contents],
      );
      return rows.map((r) => ({ id: r.id, index: r.chunk_index, content: r.content }));
    });
  }

  async setChunkEmbeddings(userId: string, rows: Array<{ id: string; vector: string }>): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `update bookmark_chunks c set embedding = v.vec::vector
         from unnest($1::uuid[], $2::text[]) as v(id, vec)
        where c.id = v.id and c.user_id = $3`,
      [rows.map((r) => r.id), rows.map((r) => r.vector), userId],
    );
  }

  async chunksMissingEmbedding(limit: number): Promise<Array<{ id: string; userId: string; content: string }>> {
    const { rows } = await this.db.query<{ id: string; user_id: string; content: string }>(
      'select id, user_id, content from bookmark_chunks where embedding is null and is_private = false order by created_at limit $1',
      [limit],
    );
    return rows.map((r) => ({ id: r.id, userId: r.user_id, content: r.content }));
  }

  async searchChunks(p: SearchParams): Promise<SearchHit[]> {
    return this.db.tx(async (q) => {
      // pgvector 0.8+: keep scanning the index until enough rows pass the filters. Older versions reject the setting:
      // roll that one statement back and carry on (results may then be sparse for very selective filters).
      await q.query('savepoint iterative_scan');
      try {
        await q.query("set local hnsw.iterative_scan = 'relaxed_order'");
      } catch {
        await q.query('rollback to savepoint iterative_scan');
      }
      const { rows } = await q.query(
        `select * from search_chunks($1::uuid, $2::text, $3::vector, $4::text, $5::timestamptz, $6::timestamptz, $7::int)`,
        [p.userId, p.tsQuery, p.embedding ? toPgVector(p.embedding) : null, p.platform, p.from, p.to, p.limit],
      );
      return rows.map(
        (r): SearchHit => ({
          chunkId: r.chunk_id,
          bookmarkId: r.bookmark_id,
          chunkIndex: r.chunk_index,
          content: r.content,
          title: r.title,
          url: r.url,
          platform: r.platform,
          savedAt: new Date(r.saved_at),
          score: Number(r.score),
          vecRank: r.vec_rank ?? null,
          ftsRank: r.fts_rank ?? null,
        }),
      );
    });
  }

  /* ---------------------------------------------------------------- reminders (Feature 4) */

  async findReviewCandidates(p: { afterHours: number; maxAgeDays: number; limit: number }): Promise<ReviewCandidate[]> {
    const { rows } = await this.db.query(
      `select b.id as bookmark_id, b.user_id, b.title, b.url, b.platform, b.created_at,
              n.timezone, coalesce(s.total_steps, 0)::int as total_steps, coalesce(s.open_steps, 0)::int as open_steps
         from bookmarks b
         left join notification_prefs n on n.user_id = b.user_id
         left join lateral (
                select count(*) as total_steps, count(*) filter (where o.done_at is null) as open_steps
                  from oneclist_items o
                 where o.bookmark_id = b.id and o.source = 'ai'
              ) s on true
        where b.created_at <= now() - make_interval(hours => $1::int)
          and b.created_at >  now() - make_interval(days => $2::int)
          and b.first_opened_at is null
          and b.archived_at is null
          and b.is_private = false
          and coalesce(n.push_enabled, true)
          and not exists (select 1 from reminder_queue q where q.bookmark_id = b.id and q.kind = 'review_48h')
        order by b.user_id, (coalesce(s.open_steps, 0) > 0) desc, b.created_at desc
        limit $3`,
      [p.afterHours, p.maxAgeDays, p.limit],
    );
    return rows.map(
      (r): ReviewCandidate => ({
        bookmarkId: r.bookmark_id,
        userId: r.user_id,
        title: r.title,
        url: r.url,
        platform: r.platform,
        createdAt: new Date(r.created_at),
        timezone: r.timezone,
        totalSteps: r.total_steps,
        openSteps: r.open_steps,
      }),
    );
  }

  async countReminders(userId: string, from: Date, to: Date): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      "select count(*)::int as n from reminder_queue where user_id = $1 and status <> 'cancelled' and send_after >= $2 and send_after < $3",
      [userId, from, to],
    );
    return rows[0]?.n ?? 0;
  }

  async enqueueReminder(r: { userId: string; bookmarkId: string; kind: 'review_48h'; payload: NotificationPayload; sendAfter: Date }): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `insert into reminder_queue (user_id, bookmark_id, kind, payload, send_after)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (bookmark_id, kind) do nothing`,
      [r.userId, r.bookmarkId, r.kind, JSON.stringify(r.payload), r.sendAfter],
    );
    return (rowCount ?? 0) > 0;
  }

  async cancelStaleReminders(): Promise<number> {
    const { rowCount } = await this.db.query(
      `update reminder_queue q set status = 'cancelled', last_error = 'bookmark opened, archived or private'
         from bookmarks b
        where b.id = q.bookmark_id and q.status = 'pending'
          and (b.first_opened_at is not null or b.archived_at is not null or b.is_private)`,
    );
    return rowCount ?? 0;
  }

  async claimDueReminders(limit: number): Promise<ClaimedReminder[]> {
    const { rows } = await this.db.query(
      `with due as (
         select id from reminder_queue
          where (status = 'pending' and send_after <= now())
             or (status = 'sending' and claimed_at < now() - interval '10 minutes')   -- a worker died mid-send
          order by send_after
          limit $1
          for update skip locked
       )
       update reminder_queue q
          set status = 'sending', claimed_at = now(), attempts = q.attempts + 1
         from due
        where q.id = due.id
       returning q.id, q.user_id, q.bookmark_id, q.payload, q.attempts`,
      [limit],
    );
    return rows.map((r): ClaimedReminder => ({ id: r.id, userId: r.user_id, bookmarkId: r.bookmark_id, payload: r.payload, attempts: r.attempts }));
  }

  async markReminderSent(id: string): Promise<void> {
    await this.db.query("update reminder_queue set status = 'sent', sent_at = now(), last_error = null where id = $1", [id]);
  }

  async markReminderRetry(id: string, sendAfter: Date, error: string): Promise<void> {
    await this.db.query("update reminder_queue set status = 'pending', send_after = $2, last_error = $3, claimed_at = null where id = $1", [id, sendAfter, error]);
  }

  async markReminderFailed(id: string, status: 'failed' | 'cancelled', error: string): Promise<void> {
    await this.db.query('update reminder_queue set status = $2, last_error = $3 where id = $1', [id, status, error]);
  }
}

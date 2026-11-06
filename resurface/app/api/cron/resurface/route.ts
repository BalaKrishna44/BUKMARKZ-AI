import { admin, isCron, json } from '@/lib/server';
import { generateQuiz, pickQuizItems, QUIZ_MODEL } from '@/lib/resurface/quiz';

export const runtime = 'nodejs';
export const maxDuration = 60;

const USERS_PER_RUN = Number(process.env.RESURFACE_USERS_PER_RUN ?? 30);
const QUIZZES_PER_RUN = Number(process.env.RESURFACE_QUIZZES_PER_RUN ?? 30);
const BUDGET_MS = 48_000;                                  // stop starting new work well before the 60 s platform limit
const STALE_MS = 10 * 60_000;
const MAX_QUIZ_ATTEMPTS = 2;

async function pool<T>(items: T[], n: number, t0: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && Date.now() - t0 < BUDGET_MS) { const x = items[i++]; await fn(x); }
  }));
}

/**
 * Nightly job. Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`; pg_net can POST the same header.
 * Schedule it several times in the early-morning window (see vercel.json): each run takes the next users who have no batch yet,
 * so a big user base is drained over a few runs and a crashed run is simply picked up by the next one.
 *   1. picker   generate_daily_resurface(user): SQL, idempotent per (user, date)
 *   2. quiz     Claude Haiku writes one recall question from a saved page, validated against the page text
 */
async function run(req: Request) {
  if (!isCron(req)) return json({ error: 'unauthorized' }, 401);
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const stats = { users: 0, batches: 0, empty: 0, quizzes: { done: 0, none: 0, failed: 0 }, errors: 0 };

  // 1. picker
  const { data: pending, error } = await admin.rpc('resurface_pending_users', { p_limit: USERS_PER_RUN, p_for: today });
  if (error) { console.error('resurface_pending_users failed', error.code); return json({ error: 'db_error' }, 500); }
  const users = ((pending ?? []) as { user_id: string }[]).map((r) => r.user_id);
  stats.users = users.length;
  await pool(users, 4, t0, async (uid) => {
    const { error: e } = await admin.rpc('generate_daily_resurface', { user_uuid: uid, p_for: today });
    if (e) { stats.errors++; console.error('generate_daily_resurface failed', e.code); } else stats.batches++;       // ids and content never logged
  });

  // 2. quizzes: today's ready batches that still need one (includes earlier crashed or failed attempts)
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const { data: rows } = await admin.from('daily_resurface').select('id,user_id,item_ids,quiz_attempts')
    .eq('for_date', today).eq('status', 'ready')
    .or(`quiz_status.eq.pending,and(quiz_status.eq.failed,quiz_attempts.lt.${MAX_QUIZ_ATTEMPTS}),and(quiz_status.eq.processing,quiz_claimed_at.lt.${stale})`)
    .limit(QUIZZES_PER_RUN);

  await pool(rows ?? [], 3, t0, async (row) => {
    // atomic claim: overlapping cron runs never spend two Claude calls on one batch
    const { data: claimed } = await admin.from('daily_resurface').update({ quiz_status: 'processing', quiz_claimed_at: new Date().toISOString() })
      .eq('id', row.id).or(`quiz_status.in.(pending,failed),and(quiz_status.eq.processing,quiz_claimed_at.lt.${stale})`).select('id');
    if (!claimed?.length) return;
    try {
      const { data: items } = await admin.from('oneclist_items').select('id,title,summary,note,ai_status,full_markdown_content,ocr_extracted_text')
        .in('id', row.item_ids).eq('user_id', row.user_id);
      const byId = new Map((items ?? []).map((i) => [i.id, i]));
      const ordered = (row.item_ids as string[]).map((id) => byId.get(id)).filter(Boolean) as NonNullable<typeof items>;
      const candidates = pickQuizItems(ordered, 2);
      let quiz = null; let usedItem: string | null = null;
      for (const c of candidates) {
        quiz = await generateQuiz(String(c.item.title ?? ''), c.source);
        if (quiz) { usedItem = c.item.id; break; }
      }
      if (quiz) {
        await admin.from('daily_resurface').update({ quiz_status: 'done', quiz_question: quiz.question, quiz_answer: quiz.answer, quiz_evidence: quiz.evidence, quiz_item_id: usedItem }).eq('id', row.id);
        stats.quizzes.done++;
      } else {
        await admin.from('daily_resurface').update({ quiz_status: 'none' }).eq('id', row.id);                   // nothing usable: final, the card simply has no quiz today
        stats.quizzes.none++;
      }
    } catch (e) {
      stats.quizzes.failed++;
      console.error('resurface quiz failed', QUIZ_MODEL(), (e as Error)?.message?.slice(0, 60));
      const attempts = (row.quiz_attempts ?? 0) + 1;
      await admin.from('daily_resurface').update({ quiz_status: attempts >= MAX_QUIZ_ATTEMPTS ? 'none' : 'failed', quiz_attempts: attempts }).eq('id', row.id);
    }
  });

  return json({ ...stats, ms: Date.now() - t0 });
}
export const GET = run;
export const POST = run;

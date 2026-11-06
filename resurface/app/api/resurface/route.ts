import { admin, json, requireUser } from '@/lib/server';
import { whyText, type Pick } from '@/lib/resurface/why';

export const runtime = 'nodejs';

/** GET -> the signed-in user's latest batch from the last 3 days (so one missed night still shows something). */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const [{ data: prefs }, { data: row }] = await Promise.all([
    admin.from('resurface_prefs').select('enabled').eq('user_id', user.id).maybeSingle(),
    admin.from('daily_resurface').select('id,for_date,item_ids,picks,quiz_question,quiz_answer,quiz_evidence,quiz_status,quiz_result')
      .eq('user_id', user.id).eq('status', 'ready').gte('for_date', new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)).order('for_date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const headers = { 'cache-control': 'private, no-store' };
  if (prefs && prefs.enabled === false) return json({ paused: true, resurface: null }, 200, headers);
  if (!row) return json({ paused: false, resurface: null }, 200, headers);

  const { data: items } = await admin.from('oneclist_items').select('id,title,url,favicon_url,created_at,last_opened_at')
    .in('id', row.item_ids).eq('user_id', user.id).is('shelved_at', null);
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const picks = new Map(((row.picks ?? []) as Pick[]).map((p) => [p.id, p]));
  const list = (row.item_ids as string[]).flatMap((id) => {
    const it = byId.get(id); if (!it) return [];
    let host = ''; try { host = new URL(it.url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
    const p = picks.get(id);
    return [{ id, title: it.title || host || it.url, url: it.url, host, favicon: it.favicon_url ?? null, opened: !!it.last_opened_at && Date.parse(it.last_opened_at) >= Date.parse(row.for_date), why: p ? whyText(p, it.created_at) : '' }];
  });
  return json({
    paused: false,
    resurface: { id: row.id, date: row.for_date, items: list, quiz: row.quiz_status === 'done' && row.quiz_question ? { question: row.quiz_question, answer: row.quiz_answer, evidence: row.quiz_evidence, result: row.quiz_result } : null },
  }, 200, headers);
}

/**
 * Composition root: wires real clients to the modules and runs the periodic jobs.
 *
 *   node src/worker.ts           run forever (reminders every minute, scheduler every 15 minutes, repair every 10)
 *   node src/worker.ts --once    one pass, then exit: for an external cron (cron, Cloud Scheduler, pg_cron + HTTP)
 *
 * Environment: DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY (embeddings).
 * Per-bookmark AI work (Features 1-3) is NOT here: call processBookmark() from your job queue when a bookmark is saved.
 */
import pg from 'pg';
import { ConsolePushSender, runDispatcherTick, type PushSender } from './dispatcher.ts';
import { OpenAiEmbedder } from './embeddings.ts';
import { embedMissing } from './indexer.ts';
import { createAnthropicClient } from './llm.ts';
import { PgStore } from './repo.ts';
import { runSchedulerTick } from './scheduler.ts';
import type { Db } from './types.ts';

export function dbFromPool(pool: pg.Pool): Db {
  return {
    query: (text, params) => pool.query(text, params as unknown[]) as any,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (text, params) => client.query(text, params as unknown[]) as any });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export async function buildApp(sender: PushSender = new ConsolePushSender()) {
  const pool = new pg.Pool({ connectionString: need('DATABASE_URL'), max: 5 });
  const store = new PgStore(dbFromPool(pool));
  const embedder = new OpenAiEmbedder({ apiKey: need('OPENAI_API_KEY') });
  const client = await createAnthropicClient();
  return { pool, store, embedder, client, sender };
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const app = await buildApp();
  const log = (what: string, data: unknown) => console.log(new Date().toISOString(), what, JSON.stringify(data));

  const tick = {
    dispatch: async () => log('dispatch', await runDispatcherTick({ store: app.store, sender: app.sender })),
    schedule: async () => log('schedule', await runSchedulerTick({ store: app.store, onError: (e, u) => console.error('scheduler error for user', u, e) })),
    repair: async () => log('embed-missing', await embedMissing({ store: app.store, embedder: app.embedder })),
  };

  const safe = (name: keyof typeof tick) => async () => {
    try {
      await tick[name]();
    } catch (err) {
      console.error(`${name} failed`, err); // a failed pass never stops the loop; the next tick tries again
    }
  };

  if (once) {
    await safe('schedule')();
    await safe('dispatch')();
    await safe('repair')();
    await app.pool.end();
    return;
  }

  const timers = [setInterval(safe('dispatch'), 60_000), setInterval(safe('schedule'), 15 * 60_000), setInterval(safe('repair'), 10 * 60_000)];
  await safe('schedule')();
  const stop = async () => {
    timers.forEach(clearInterval);
    await app.pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

// Run only when started directly, not when imported by tests or other modules.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

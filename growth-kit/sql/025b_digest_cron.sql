-- 025b: schedule the edge function. NOT part of the test run (needs pg_cron + pg_net, available on Supabase).
-- Once, in the SQL editor, store the secrets in Vault (never in this file):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'digest_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('weekly-digest') where exists (select 1 from cron.job where jobname = 'weekly-digest');
select cron.schedule(
  'weekly-digest',
  '30 3 * * 1',                                       -- Mondays 03:30 UTC = 09:00 IST
  $$ select net.http_post(
       url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/weekly-digest',
       headers := jsonb_build_object('content-type', 'application/json',
                    'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret')),
       body    := '{}'::jsonb,
       timeout_milliseconds := 55000) $$);
-- Safe to fire twice: claim_digest_users() stamps last_sent_at atomically and skips anyone mailed in the last 6 days.

-- 030b: schedule the scanner. NOT part of the test run (needs pg_cron + pg_net, available on Supabase). Same Vault secrets as 025b/029b:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'digest_cron_secret');
-- Every 10 minutes the function claims up to 60 due links, so capacity is ~8,600 checks/day; with a 14-day cycle that covers ~120,000 saved links.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('check-link-health') where exists (select 1 from cron.job where jobname = 'check-link-health');
select cron.schedule('check-link-health', '*/10 * * * *', $$ select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-link-health',
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 120000) $$);

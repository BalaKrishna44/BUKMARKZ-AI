-- 029b: schedule "Friday Vault After-Hours". NOT part of the test run (needs pg_cron + pg_net, available on Supabase). Uses the same Vault secrets as 025b:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'digest_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Every hour: send to whoever's local clock just reached Friday 16:00 (the database decides who; most runs claim nobody and cost one cheap query).
select cron.unschedule('friday-after-hours') where exists (select 1 from cron.job where jobname = 'friday-after-hours');
select cron.schedule('friday-after-hours', '5 * * * *', $$ select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-friday-digest',
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret')),
  body := '{"action":"send"}'::jsonb, timeout_milliseconds := 55000) $$);

-- 2) Thursday 12:00 UTC: write next day's joke early, so a human can block it before anyone is mailed:
--      update friday_jokes set status = 'blocked' where week_key = '2026-W44';   -- the sender then uses a curated joke instead
select cron.unschedule('friday-prepare') where exists (select 1 from cron.job where jobname = 'friday-prepare');
select cron.schedule('friday-prepare', '0 12 * * 4', $$ select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-friday-digest',
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret')),
  body := '{"action":"prepare"}'::jsonb, timeout_milliseconds := 55000) $$);

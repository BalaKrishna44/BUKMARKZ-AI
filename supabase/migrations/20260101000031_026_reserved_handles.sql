-- 026: public portfolio URLs are bukmarkz.com/<handle>/<slug>, so a handle is now part of our URL space.
-- Without this, anyone could claim "admin", "support" or "dashboard" and host a page that looks official at bukmarkz.com/admin/<anything>.
-- NOT VALID = enforced for every new or changed handle without failing on rows that already exist. Check them, then VALIDATE:
--   select handle from creator_profiles where handle = any(<list below>);   -- rename/contact these users, then:
--   alter table creator_profiles validate constraint creator_profiles_handle_not_reserved;
alter table creator_profiles drop constraint if exists creator_profiles_handle_not_reserved;
alter table creator_profiles add constraint creator_profiles_handle_not_reserved check (handle <> all (array[
  'admin','administrator','api','app','about','account','auth','billing','blog','bukmarkz','buk','markz','contact','dashboard','docs','download',
  'explore','extension','fork','help','home','login','logout','mcp','new','null','pricing','privacy','register','root','search','security','settings',
  'signin','signup','stack','stacks','static','status','support','team','terms','undefined','www','vault','verify','legal','press','careers','jobs'
])) not valid;

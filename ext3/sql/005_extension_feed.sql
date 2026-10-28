-- Extension feed. Run after 001, 002 (categories) and 004 (summary). Idempotent.
-- The extension saves the tab's favicon and meta description; the AI fills `summary` and `category_id` later.
alter table oneclist_items
  add column if not exists favicon_url      text check (favicon_url is null or favicon_url ~ '^https?://' and char_length(favicon_url) <= 2048),
  add column if not exists meta_description text check (meta_description is null or char_length(meta_description) <= 300);

-- The popup reads this view with the user's own JWT. security_invoker makes the underlying RLS apply
-- (without it the view would run as its owner and could expose every user's rows).
create or replace view extension_feed with (security_invoker = true) as
select i.id,
       i.title,
       i.url,
       coalesce(i.favicon_url, 'https://www.google.com/s2/favicons?sz=64&domain=' || substring(i.url from '^https?://([^/:?#]+)')) as favicon_url,
       c.name                                   as ai_category,     -- AI-assigned category (null until organised)
       coalesce(i.summary, i.meta_description)  as summary_tldr,    -- AI summary, else the page's own description
       i.created_at
from oneclist_items i
left join categories c on c.id = i.category_id;

grant select on extension_feed to authenticated;

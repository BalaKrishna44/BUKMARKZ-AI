-- columns that resurface/sql/011 adds in the real schema
alter table oneclist_items add column if not exists last_opened_at timestamptz, add column if not exists shelved_at timestamptz;

-- Zero-knowledge photo backup: metadata only. The server never sees plaintext or keys.
-- Run in the Supabase SQL editor or via `supabase db push`.

create type public.upload_status as enum ('pending', 'verified');

create table public.user_photos (
  photo_id             uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,

  -- Dedup fingerprint. NOT a plain SHA-256 of the file: it is
  -- HMAC-SHA256(hashKey, per-chunk SHA-256 digests || plaintext length), where hashKey
  -- is derived from the user's secret. This keeps dedup working per user while
  -- preventing the server (or a breach) from confirming "this user holds file X".
  file_hash            text   not null check (file_hash ~ '^[0-9a-f]{64}$'),

  -- 12-byte base nonce of the file; chunk i uses base XOR counter(i) in its last 4 bytes.
  encryption_iv        bytea  not null check (octet_length(encryption_iv) = 12),
  -- Per-file AES-256 key wrapped with the user's wrap key: iv(12) || ct(32) || tag(16).
  wrapped_key          bytea  not null check (octet_length(wrapped_key) = 60),
  chunk_size_log2      smallint not null default 22 check (chunk_size_log2 between 16 and 26),

  file_size_bytes      bigint not null check (file_size_bytes > 0),        -- ciphertext size
  plaintext_size_bytes bigint not null check (plaintext_size_bytes >= 0),
  media_type           text   not null check (media_type in ('image', 'video')),
  object_key           text   not null,
  taken_at             timestamptz,

  upload_status        public.upload_status not null default 'pending',
  created_at           timestamptz not null default now(),
  verified_at          timestamptz,

  unique (user_id, file_hash),
  unique (object_key),
  check ((upload_status = 'verified') = (verified_at is not null))
);

create index user_photos_user_status_idx on public.user_photos (user_id, upload_status);
create index user_photos_pending_age_idx on public.user_photos (created_at) where upload_status = 'pending';

-- Per-user KDF parameters and a key-check blob so a wrong secret is detected before any upload.
-- Nothing here lets the server derive the key (Argon2id salt + params are public by design).
create table public.user_crypto (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  kdf         text   not null default 'argon2id',
  kdf_salt    bytea  not null check (octet_length(kdf_salt) = 16),
  kdf_params  jsonb  not null,         -- {"ops":3,"memKiB":65536} or {"iter":600000}
  key_check   bytea  not null,         -- AES-GCM(wrapKey, "bukmarkz-key-check")
  created_at  timestamptz not null default now()
);

alter table public.user_photos enable row level security;
alter table public.user_crypto enable row level security;

-- Clients may only READ their own rows. All writes go through the API routes
-- (service role), so a client can never mark its own upload 'verified'.
create policy "own photos readable" on public.user_photos
  for select to authenticated using (auth.uid() = user_id);
create policy "own crypto readable" on public.user_crypto
  for select to authenticated using (auth.uid() = user_id);

revoke insert, update, delete on public.user_photos from anon, authenticated;
revoke all on public.user_photos from anon;
revoke insert, update, delete on public.user_crypto from anon, authenticated;
revoke all on public.user_crypto from anon;

-- Stale 'pending' rows (abandoned uploads) older than 24h should be garbage collected together with
-- their R2 objects; do that from a scheduled job that also calls DeleteObject (see README).

-- 0005_sessions.sql — A2: the opaque session store. The cookie carries a random token; only its sha256
-- HASH is stored, so a DB leak never exposes a live session. `actor_id` is the authenticated principal;
-- the Caller extractor resolves (actor + platform_role) from a non-expired row. (plan slice A2.)
create table sessions (
  id         text primary key,                       -- SES_<hex>
  actor_id   text not null references entities(id) on delete cascade,
  token_hash text not null unique,                    -- sha256(opaque cookie token), hex
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_actor_idx on sessions(actor_id);

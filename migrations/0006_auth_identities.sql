-- 0006_auth_identities.sql — E1: the social-login link. ONE actor can link many providers; the upsert key
-- is (provider, sub) — NEVER email (emails change / aren't unique across providers). An identity points at
-- an actor entity; first login mints the actor. (plan slice E1; matches the RedPash upsert-by-sub.)
create table auth_identities (
  provider   text not null,
  sub        text not null,
  actor_id   text not null references entities(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now(),
  primary key (provider, sub)
);
create index auth_identities_actor_idx on auth_identities(actor_id);

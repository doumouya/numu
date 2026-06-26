-- 0003_rbac.sql — A0: the RBAC data foundation. Roles-as-data (a custom role is a row, not a Rust enum),
-- the membership edge made WRITE-sound (exactly one role per (object,member) so demote/last-owner/grant
-- are provable), and the actor type + dev principal so every object can have a real owner. Pure data —
-- no HTTP/auth changes; the reach resolver (B1) builds on this. (docs/OBJECTS.md G2, plan slice A0.)

-- ── roles registry ────────────────────────────────────────────────────────────
-- effective role = max(rank) over a caller's edges; an Action floor is a rank threshold; a custom role is
-- a row with a rank. Contiguous ranks 1..N, no gaps (the resolver degrades silently otherwise — asserted
-- in the A0 test). Replaces RedPash's hardcoded role->rank CASE WHEN with a join.
create table roles (
  role       text primary key,
  rank       integer not null unique,        -- higher = more authority; viewer<member<admin<owner
  is_builtin boolean not null default false
);
insert into roles (role, rank, is_builtin) values
  ('viewer', 1, true),
  ('member', 2, true),
  ('admin',  3, true),
  ('owner',  4, true);

-- ── memberships: one role per (object, member) ────────────────────────────────
-- WAS pk(object_id,member_id,role,context_role): role-stacking let a single (object,member) hold many
-- role rows, making "demote", "last-owner", and "only-owner-grants-owner" UNPROVABLE (a demote INSERT
-- stacked instead of replacing; max(rank) returned the stale role). Narrow the key so a role change is a
-- single-row UPDATE/UPSERT. Drop the inline CHECK in favour of an FK to the roles registry: a custom role
-- now grants, and a bad role is a mapped 23503 -> 422, never the previously unmapped 23514 -> 500.
alter table memberships drop constraint memberships_pkey;
alter table memberships drop constraint memberships_role_check;
alter table memberships add constraint memberships_pkey primary key (object_id, member_id);
alter table memberships add constraint memberships_role_fkey foreign key (role) references roles(role);
-- context_role stays a non-key cosmetic column (day-one #9: never read by enforcement).

-- ── actor (USR) ───────────────────────────────────────────────────────────────
-- An identity IS an entity, so memberships.member_id -> entities(id) already fits. Seed the type so the
-- registry exposes /api/objects/actor, AND bootstrap the dev principal as a real entities+entity_data row
-- so grant_owner (B1) has a member to point at — without this row every owner write would 23503.
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('actor', 'USR', 'Actor', 'Actors', '[]', true, 1);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('actor', 'display_name',  'Name',          'text', true,  true,  1, 'standard',    '{}'),
  ('actor', 'handle',        'Handle',        'text', true,  true,  2, 'standard',    '{"validate":"^[a-z0-9_-]+$"}'),
  ('actor', 'email',         'Email',         'text', false, true,  3, 'owner_grade', '{}'),
  ('actor', 'kind',          'Kind',          'enum', true,  false, 4, 'readonly',    '{"enum":["human","agent","service"],"default":"human"}'),
  ('actor', 'platform_role', 'Platform role', 'enum', true,  true,  5, 'owner_grade', '{"enum":["member","admin"],"default":"member"}'),
  ('actor', 'status',        'Status',        'enum', true,  true,  6, 'standard',    '{"enum":["active","invited","disabled"],"default":"active"}');

-- the dev principal — matches Caller::dev().actor_id = 'USR_dev'.
insert into entities (id, type, created_by) values ('USR_dev', 'actor', 'USR_dev');
insert into entity_data (entity_id, type_id, data) values
  ('USR_dev', 'actor',
   '{"display_name":"Dev","handle":"dev","kind":"human","platform_role":"admin","status":"active"}');

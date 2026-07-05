-- 0018_capability_plane.sql — Plane C: capability/scope confinement for non-console surfaces
-- (apps, agents). CASE 0016. SYSTEM tables (like memberships/field_permissions): text keys,
-- CHECK-pinned vocab. Additive: no existing table touched; the gate consults these only for
-- app/agent surfaces — console stays default-allow (bounded by Planes A + B), app/agent are
-- default-DENY (absence of a matching grant = the same leak-free 404 as Plane A).

-- a reusable predicate attached to a grant. Evaluated against facts already present (actor
-- kyc_status, the grant's issue time, the declared purpose, the field's data_class from 0016)
-- → pure, so it runs in the Rust gate AND the wasm sim.
create table condition (
  id         text primary key,                 -- 'kyc_verified' · 'support_purpose' · 'no_sensitive'
  kind       text not null check (kind in
              ('kyc_verified','purpose_limited','ttl','owner_grade','max_data_class')),
  params     jsonb not null default '{}',
  --  kyc_verified    → {}                       (actor.kyc_status = 'verified')
  --  purpose_limited → {"purpose":"support"}    (the request must declare this purpose)
  --  ttl             → {"minutes":30}           (grant valid only within N minutes of issue)
  --  owner_grade     → {}                        (only an owner-grade principal passes)
  --  max_data_class  → {"ceiling":"internal"}   (may not touch fields above this data_class — ties to 0016)
  created_at timestamptz not null default now()
);

-- what a surface may do. Default-deny for app/agent: absence of a matching row = denied.
create table capability_grant (
  surface_kind text not null check (surface_kind in ('console','app','agent')),
  surface_id   text not null,                   -- app/agent entity id (e.g. APP_…); console uses '*'
  type_id      text not null,                   -- object type the grant covers; '*' = all types
  action       text not null check (action in ('view','create','edit','delete','*')),  -- ⇔ Rust Action
  scope_id     text references entities(id) on delete cascade,   -- optional: bound to a subtree; null = unscoped
  condition_id text references condition(id),   -- optional attached predicate
  created_at   timestamptz not null default now(),
  primary key (surface_kind, surface_id, type_id, action)
);
create index capability_grant_surface_idx on capability_grant(surface_kind, surface_id);

-- seed a few reusable conditions (grants reference them by id; extend from GOVERNANCE/privacy work).
insert into condition (id, kind, params) values
  ('kyc_verified',    'kyc_verified',    '{}'),
  ('support_purpose', 'purpose_limited', '{"purpose":"support"}'),
  ('no_sensitive',    'max_data_class',  '{"ceiling":"internal"}')
on conflict (id) do nothing;

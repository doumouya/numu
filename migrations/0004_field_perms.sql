-- 0004_field_perms.sql — D (Plane B): per-field read/write permissions. A field's perm_class gives a rank
-- floor (read_min, write_min) from the rank ladder; a sparse field_permissions row OVERRIDES a specific
-- (type, field, role) — resolved role→rank at check time, so a custom role slots in. Enforced AFTER the
-- object gate (403, existence already admitted); reads omit unreadable fields passively, never a 403.
-- (docs/OBJECTS.md perm_class legend, plan slice D.)
create table field_permissions (
  type_id   text not null references type_definitions(type_id) on delete cascade,
  field     text not null,
  role      text not null references roles(role),
  can_read  boolean not null default true,
  can_write boolean not null default false,
  primary key (type_id, field, role)
);

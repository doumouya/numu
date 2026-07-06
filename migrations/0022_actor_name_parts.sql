-- 0022 — actor name parts: first_name + last_name.
-- The actor identity was display_name + handle + email (0003) + avatar_url (0015); a real profile
-- wants editable given/family names. Pure registry rows — the generic handler picks them up on
-- reload, no code (docs/api/OBJECTS.md G2). display_name stays the REQUIRED rendered identity
-- (chrome, docs, publish); the parts are optional and, like every name/contact field, `personal`
-- (GOVERNANCE #1 · 0016). Mirrors the 0015 avatar_url add.

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('actor', 'first_name', 'First name', 'text', false, true, 8, 'standard', '{}'),
  ('actor', 'last_name',  'Last name',  'text', false, true, 9, 'standard', '{}');

update type_fields set data_class = 'personal' where (type_id, field) in (
  ('actor', 'first_name'),
  ('actor', 'last_name'));

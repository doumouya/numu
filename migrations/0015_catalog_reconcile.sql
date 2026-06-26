-- Catalog reconcile (CASE 0011 completeness audit) — back-fill the documented fields the EARLY seeds
-- predated. `project` was seeded in 0002 before `workspace` existed (0011), so it never got `workspace_id`
-- (the ORG→PRJ scope tree) or `default_branch`; `actor` (0003) never got `avatar_url`. These are pure
-- registry rows — the generic handler picks them up on reload, no code. (docs/OBJECTS.md G2.)
--
-- `workspace_id` is added as an OPTIONAL set-once scope_parent (not required): NON-BREAKING — a project may
-- still be created at root (no workspace), but a project given a workspace_id now reach-scopes up to it.
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('project', 'workspace_id',   'Workspace',      'ref',  false, false, 0, 'standard', '{"ref":"ORG"}'),
  ('project', 'default_branch', 'Default branch', 'text', false, true,  6, 'standard', '{"default":"main"}'),
  ('actor',   'avatar_url',     'Avatar',         'text', false, true,  7, 'standard', '{}');

-- wire project into the scope tree (the reach resolver climbs scope_parents; an unset workspace_id = root).
update type_definitions set scope_parents = '["workspace_id"]' where type_id = 'project';

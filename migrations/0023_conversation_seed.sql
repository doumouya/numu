-- 0023 — the `conversation` type: one persistent feed per workspace (SLICE 2a, CAS_00742b86).
-- The console's thread was session-local in HTTP mode (the driver's feed/appendFeed calls 404'd).
-- A conversation is a registry row scoped to its workspace, so reach follows the workspace: any
-- member who reaches the workspace reads the feed, edit-rank appends. `blocks` is the ordered
-- feed (the same block vocabulary the sim persists to localStorage). One row per workspace — the
-- conversations handler upserts by workspace_id.

insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('conversation', 'CNV', 'Conversation', 'Conversations', '["workspace_id"]', true, 213);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('conversation', 'workspace_id', 'Workspace', 'ref',  true,  false, 1, 'standard', '{"ref":"ORG"}'),
  ('conversation', 'blocks',       'Blocks',    'json', false, true,  2, 'standard', '{}');

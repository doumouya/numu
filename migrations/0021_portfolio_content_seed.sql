-- 0021_portfolio_content_seed.sql — the portfolio app's CONTENT types (CASE 0024;
-- docs/apps/PORTFOLIO.md §publish). Registry rows again: Em edits these in the numu console
-- (normal RBAC/audit/events apply — content edits leave the same evidence as any mutation),
-- then POST /api/apps/portfolio/publish renders content/site.json + the genpdf CV PDF and
-- commits them to the portfolio repo. Published output is derived FROM these rows — the
-- entities are the source of truth, git is the delivery vehicle.

-- ── article (ART) — one Writing essay ─────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('article', 'ART', 'Article', 'Articles', '[]', true, 210);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('article', 'slug',      'Slug',      'text', true,  false, 1, 'standard', '{"validate":"^[a-z0-9-]+$"}'),
  ('article', 'label',     'Title',     'text', true,  true,  2, 'standard', '{}'),
  ('article', 'tag',       'Tag',       'enum', true,  true,  3, 'standard', '{"enum":["METHOD","DATA","SECURITY","LEGAL"]}'),
  ('article', 'md',        'Markdown',  'text', true,  true,  4, 'standard', '{}'),
  ('article', 'published', 'Published', 'bool', false, true,  5, 'standard', '{"default":false}'),
  -- presentation order on the Writing page (ascending); newest work gets the lowest ordinal.
  ('article', 'ordinal',   'Order',     'int',  false, true,  6, 'standard', '{"default":100}');

-- ── site_copy (SCP) — a keyed prose block (overview lead/body/muted, …) ───────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('site_copy', 'SCP', 'Site copy', 'Site copy', '[]', true, 211);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('site_copy', 'key', 'Key',      'text', true,  false, 1, 'standard', '{"validate":"^[a-z0-9._-]+$"}'),
  ('site_copy', 'md',  'Markdown', 'text', true,  true,  2, 'standard', '{}');

-- ── cv (CVD) — the CV document (the cv-data JSON contract, one row) ───────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('cv', 'CVD', 'CV', 'CVs', '[]', true, 212);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('cv', 'name', 'Name', 'text', true,  true, 1, 'standard', '{}'),
  -- the full CvData document (the portfolio front's cv-data contract; the genpdf writer and
  -- the site's HTML renderer both consume exactly this shape).
  ('cv', 'doc',  'Document', 'json', true, true, 2, 'standard', '{}');

-- 0020_portfolio_ingest_seed.sql — the portfolio app's ingest types (CASE 0022;
-- docs/apps/PORTFOLIO.md). Registry ROWS, not engine changes: `pt_event` (anonymous visitor
-- telemetry, privacy-clean by construction — no ids, no UA, banded viewport, bucketed dwell)
-- and `feedback` (explicit visitor submissions; free text ⇒ data_class raised to `personal`).
-- Both are IMMUTABLE at the HTTP surface (method_policy masks PUT/PATCH; delete stays open for
-- retention — GOVERNANCE #4). Writes arrive ONLY through the app's /ingest route acting as the
-- Plane-C-confined service actor `SVC_collector`: create-only on exactly these two types,
-- default-deny everywhere else (0018) — the confinement story made real.

-- ── pt_event (PTE) — one anonymous telemetry event ────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal, method_policy)
values ('pt_event', 'PTE', 'Portfolio event', 'Portfolio events', '[]', true, 200, '{"mask":["PUT","PATCH"]}');

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('pt_event', 'kind', 'Kind', 'enum', true,  false, 1, 'standard',
   '{"enum":["route_view","feedback_ui","cv_download","link_click","settings_change","install","writing_filter","dwell"]}'),
  ('pt_event', 'page', 'Page',             'text', true,  false, 2, 'standard', '{}'),
  ('pt_event', 'slug', 'Slug',             'text', false, false, 3, 'standard', '{}'),
  ('pt_event', 'ref',  'Referrer origin',  'text', false, false, 4, 'standard', '{}'),
  ('pt_event', 'vp',   'Viewport band',    'enum', false, false, 5, 'standard', '{"enum":["xs","sm","md","lg"]}'),
  ('pt_event', 'lang', 'Language',         'text', false, false, 6, 'standard', '{}'),
  ('pt_event', 'mode', 'Mode',             'enum', false, false, 7, 'standard', '{"enum":["light","dark"]}'),
  ('pt_event', 'ts',   'Client timestamp', 'text', false, false, 8, 'standard', '{}'),
  -- kind-specific small payload (target/setting/value/bucket/action/from/tag) — validated by the
  -- ingest route's strict schema BEFORE it ever reaches the registry write path.
  ('pt_event', 'meta', 'Meta',             'json', false, false, 9, 'standard', '{}');

-- ── feedback (FBK) — an explicit visitor submission ───────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal, method_policy)
values ('feedback', 'FBK', 'Feedback', 'Feedback', '[]', true, 201, '{"mask":["PUT","PATCH"]}');

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('feedback', 'stars', 'Stars', 'int',  true,  false, 1, 'standard', '{}'),   -- 1–5, enforced by the ingest schema
  ('feedback', 'text',  'Text',  'text', false, false, 2, 'standard', '{}'),
  ('feedback', 'page',  'Page',  'text', true,  false, 3, 'standard', '{}'),
  ('feedback', 'ts',    'Client timestamp', 'text', false, false, 4, 'standard', '{}');

-- free text routinely carries whatever the visitor types — classify it PERSONAL (0016 manifest
-- style) so the access audit + ceiling conditions treat it accordingly.
update type_fields set data_class = 'personal' where (type_id, field) in (('feedback', 'text'));

-- ── SVC_collector — the confined service principal the /ingest route acts as ──
insert into entities (id, type, created_by) values ('SVC_collector', 'actor', 'SVC_collector');
insert into entity_data (entity_id, type_id, data) values
  ('SVC_collector', 'actor',
   '{"display_name":"Portfolio collector","handle":"svc_collector","kind":"service","platform_role":"member","status":"active"}');

-- Plane C: create-only on exactly the two ingest types. No view/edit/delete rows — absence is
-- denial (0018 default-deny), so the collector cannot read back even what it wrote.
insert into capability_grant (surface_kind, surface_id, type_id, action) values
  ('agent', 'SVC_collector', 'pt_event', 'create'),
  ('agent', 'SVC_collector', 'feedback', 'create');

-- insights aggregations key on the event kind — a partial expression index keeps them cheap.
create index pt_event_kind_idx on entity_data ((data->>'kind')) where type_id = 'pt_event';

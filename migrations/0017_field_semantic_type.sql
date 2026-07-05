-- 0017_field_semantic_type.sql — the semantic-type layer on type_fields + a reusable field-domain
-- registry, and an `accent` presentation slot on type_definitions (CASE 0015; the metadata backbone
-- the nacl autocomplete, client validation, and the renderer read).
-- ADDITIVE & backward-compatible: every new column is nullable/defaulted, so existing INSERTs
-- (explicit column lists) and runtime `query` reads (map by name, ignore extra columns) are untouched.
-- Consuming code (autocomplete, validation, renderer) wires in later slices.

-- 1 · meaning ABOVE the storage `kind` (text|int|bool|date|json|ref|enum).
--     kind = how it's stored; semantic_type = what it MEANS; autocomplete + validate read it.
alter table type_fields
  add column semantic_type text,   -- null = plain primitive. e.g. money·email·region·geo·percent·phone·url·duration
  add column domain_ref    text;   -- optional soft ref → field_domain(id): the value vocabulary

-- 2 · reusable value vocabularies (the autocomplete's field-domain source; complements the
--     inline enum/ref already carried per-field in type_fields.options for one-offs).
create table field_domain (
  id         text primary key,     -- 'fr_regions' · 'currency_iso4217' · 'case_status'
  kind       text not null,        -- enum | lookup | ref
  label      text,
  params     jsonb not null default '{}',
  --  enum   → {"values":["active","churned"]}
  --  lookup → {"source":"db:public.fr_regions","col":"name"}     (distinct-from-a-table)
  --  ref    → {"type":"user"}                                     (values are entity ids of a type)
  created_at timestamptz not null default now()
);

-- seed the domains the sim already implies, so autocomplete can source values on day one.
insert into field_domain (id, kind, label, params) values
  ('currency_iso4217', 'enum', 'ISO-4217 currency',   '{"values":["XOF","EUR","USD","GBP","NGN"]}'),
  ('case_status',      'enum', 'Case workflow state', '{"values":["open","in_review","blocked","done"]}')
on conflict (id) do nothing;

-- 3 · presentation: type_definitions already has icon + display_name(_plural); add the accent TOKEN
--     so the renderer, nacl feed-blocks, and the PWA manifest read ONE presentation set.
--     Token name only — never a raw color (css-drift rule).
alter table type_definitions
  add column accent text;          -- e.g. '--chart-6'

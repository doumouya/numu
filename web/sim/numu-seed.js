/* numu-sim · numu-seed.js — registry seed: roles, workflows, type catalog
   (CATALOG.md-locked subset), both tenants (numu platform + ORVCLE per
   ORVCLE-DATA-MODEL.md), memberships, and the per-project demo feeds.       */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  root.NumuSeed = mod;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function F(field, kind, opts) { return Object.assign({ field: field, kind: kind, required: false, editable: true, perm_class: "standard", options: {} }, opts || {}); }

  var TYPES = [
    { type_id: "workspace", id_prefix: "ORG", plural: "workspaces", scope_parents: [], context_view: "record", fields: [
      F("name", "text", { required: true, searchable: true }), F("slug", "text", { editable: false }),
      F("status", "enum", { options: { enum: ["active", "suspended"], default: "active" }, perm_class: "owner_grade" }),
      F("default_currency", "text", { options: { validate: "^[A-Z]{3}$", default: "EUR" } })] },
    { type_id: "user", id_prefix: "USR", plural: "users", scope_parents: [], context_view: "record", fields: [
      F("display_name", "text", { required: true, searchable: true }), F("handle", "text", { searchable: true }),
      F("email", "text", { perm_class: "owner_grade", data_class: "personal" }),
      F("kind", "enum", { options: { enum: ["human", "agent", "service"], default: "human" }, editable: false, perm_class: "readonly" }),
      F("status", "enum", { options: { enum: ["active", "invited", "disabled"], default: "active" } }),
      F("kyc_status", "enum", { options: { enum: ["none", "pending", "verified", "rejected"], default: "none" }, perm_class: "owner_grade" }),
      F("attributes", "json", { options: { default: {} } })] },
    { type_id: "team", id_prefix: "TEM", plural: "teams", scope_parents: ["workspace_id"], context_view: "record", fields: [
      F("workspace_id", "ref", { required: true, editable: false, options: { ref: "ORG" } }),
      F("name", "text", { required: true, searchable: true }),
      F("kind", "enum", { options: { enum: ["team", "department", "organization"], default: "team" }, editable: false }),
      F("website", "text"), F("tax_id", "text", { perm_class: "owner_grade" })] },
    { type_id: "project", id_prefix: "PRJ", plural: "projects", scope_parents: ["workspace_id"], context_view: "thread", fields: [
      F("workspace_id", "ref", { required: true, editable: false, options: { ref: "ORG" } }),
      F("name", "text", { required: true, searchable: true }), F("slug", "text", { editable: false }),
      F("status", "enum", { options: { enum: ["planning", "active", "paused", "archived"], default: "active" } }),
      F("origin", "enum", { options: { enum: ["manual", "email", "case", "connector", "web"], default: "manual" }, editable: false }),
      F("case_id", "ref", { editable: false, options: { ref: "CAS" } }),
      F("attributes", "json", { options: { default: {} } })] },
    { type_id: "case", id_prefix: "CAS", plural: "cases", scope_parents: ["project_id"], context_view: "board", fields: [
      F("project_id", "ref", { required: true, editable: false, options: { ref: "PRJ" } }),
      F("title", "text", { required: true, searchable: true, data_class: "personal" }),
      F("description", "text", { data_class: "personal" }),
      F("type", "enum", { options: { enum: ["bug", "feature", "task", "epic", "chore", "support", "incident", "request"], default: "task" } }),
      F("status", "enum", { options: { enum: [], workflow: true } }),
      F("priority", "enum", { options: { enum: ["low", "normal", "high", "urgent"], default: "normal" } }),
      F("origin", "enum", { options: { enum: ["ui", "agent", "import", "email", "web", "phone", "chat"], default: "ui" } }),
      F("workflow_id", "ref", { required: true, editable: false, perm_class: "readonly", options: { ref: "workflows", default: "default" } }),
      F("assignee_id", "ref", { options: { ref: "USR" } }), F("reporter_id", "ref", { editable: false, perm_class: "readonly", options: { ref: "USR" } }),
      F("attributes", "json", { options: { default: {} } })] },
    { type_id: "booking", id_prefix: "BKG", plural: "bookings", scope_parents: ["workspace_id"], context_view: "calendar", fields: [
      F("workspace_id", "ref", { required: true, editable: false, options: { ref: "ORG" } }),
      F("name", "text", { required: true, searchable: true }),
      F("kind", "enum", { editable: false, options: { enum: ["appointment", "session", "match", "meeting", "stream", "post", "hold", "other"], default: "session" } }),
      F("starts_at", "date", { required: true }), F("ends_at", "date"),
      F("status", "enum", { options: { enum: ["scheduled", "confirmed", "in_progress", "completed", "cancelled"], default: "scheduled" } }),
      F("address_id", "ref", { options: { ref: "ADR" } }), F("subject_id", "ref", { editable: false }),
      F("attributes", "json", { options: { default: {} } })] },
    { type_id: "address", id_prefix: "ADR", plural: "addresses", scope_parents: ["subject_id"], context_view: "map", fields: [
      F("subject_id", "ref", { required: true, editable: false }),
      F("kind", "enum", { options: { enum: ["home", "work", "billing", "shipping", "delivery", "venue", "other"], default: "other" } }),
      F("line1", "text", { required: true }), F("city", "text", { required: true }), F("country", "text", { required: true, options: { validate: "^[A-Z]{2}$" } }),
      F("attributes", "json", { options: { default: {} } })] },
    { type_id: "message", id_prefix: "MSG", plural: "messages", scope_parents: ["subject_id"], context_view: "thread", fields: [
      F("subject_id", "ref", { required: true, editable: false }),
      F("channel", "enum", { editable: false, options: { enum: ["email", "sms", "chat", "dm", "push", "letter"], default: "chat" } }),
      F("direction", "enum", { editable: false, options: { enum: ["inbound", "outbound"], default: "outbound" } }),
      F("body", "text", { required: true, searchable: true, data_class: "personal" }),
      F("status", "enum", { options: { enum: ["draft", "queued", "sent", "delivered", "failed", "received"], default: "sent" } })] },
    { type_id: "comment", id_prefix: "CMT", plural: "comments", scope_parents: ["subject_id"], context_view: "thread", fields: [
      F("subject_id", "ref", { required: true, editable: false }), F("body", "text", { required: true, data_class: "personal" }),
      F("visibility", "enum", { options: { enum: ["internal", "public"], default: "internal" } }),
      F("rating", "enum", { options: { enum: ["1", "2", "3", "4", "5"] } })] },
    { type_id: "file", id_prefix: "FIL", plural: "files", scope_parents: ["project_id"], context_view: "table", fields: [
      F("project_id", "ref", { required: true, editable: false, options: { ref: "PRJ" } }),
      F("filename", "text", { required: true, editable: false, searchable: true, options: { role: "title" } }),
      F("file_type", "enum", { editable: false, options: { enum: ["csv", "chart", "dashboard", "audio", "video", "image"], default: "csv" } }),
      F("encoding", "text", { editable: false }), F("row_count", "int", { editable: false }), F("col_count", "int", { editable: false }),
      F("cleanness", "float", { editable: false, options: { role: "metric" } }),
      F("columns_meta", "json", { editable: false, data_class: "personal", options: { default: [] } }),
      F("steps", "json", { options: { default: [] } }), F("blob_ref", "text", { editable: false, perm_class: "readonly" }),
      F("attributes", "json", { options: { default: {} } })] },
    { type_id: "chart", id_prefix: "CHT", plural: "charts", scope_parents: ["project_id"], context_view: "chart", fields: [
      F("project_id", "ref", { required: true, editable: false, options: { ref: "PRJ" } }),
      F("file_id", "ref", { editable: false, options: { ref: "FIL" } }),
      F("title", "text", { required: true, searchable: true }), F("spec", "json", { required: true, options: { default: {} } })] },
    { type_id: "dashboard", id_prefix: "DSH", plural: "dashboards", scope_parents: ["project_id"], context_view: "dashboard", fields: [
      F("project_id", "ref", { required: true, editable: false, options: { ref: "PRJ" } }),
      F("title", "text", { required: true, searchable: true }), F("spec", "json", { required: true, options: { default: { tiles: [] } } })] },
    { type_id: "connector", id_prefix: "CON", plural: "connectors", scope_parents: ["workspace_id"], context_view: "record", fields: [
      F("workspace_id", "ref", { required: true, editable: false, options: { ref: "ORG" } }),
      F("name", "text", { required: true, searchable: true }),
      F("kind", "enum", { options: { enum: ["http_json", "webhook", "sql", "file", "postgres", "mysql", "kafka"], default: "http_json" } }),
      F("target", "text"), F("status", "enum", { options: { enum: ["draft", "active", "disabled", "error"], default: "draft" } })] },
    { type_id: "transaction", id_prefix: "TXN", plural: "transactions", scope_parents: ["workspace_id"], context_view: "record", fields: [
      F("workspace_id", "ref", { required: true, editable: false, options: { ref: "ORG" } }),
      F("kind", "enum", { editable: false, options: { enum: ["payment", "refund", "deposit", "withdrawal", "payout", "fee", "adjustment"], default: "payment" } }),
      F("status", "enum", { options: { enum: ["pending", "settled", "failed", "reversed"], default: "pending" } }),
      F("amount", "int", { required: true, editable: false }), F("currency", "text", { required: true, editable: false, options: { validate: "^[A-Z]{3}$" } }),
      F("party_id", "ref", { editable: false })] },
    { type_id: "milestone", id_prefix: "MIL", plural: "milestones", scope_parents: ["subject_id"], context_view: "calendar", fields: [
      F("subject_id", "ref", { required: true, editable: false }), F("name", "text", { required: true }),
      F("kind", "enum", { options: { enum: ["sla", "deadline", "checkpoint"], default: "deadline" } }),
      F("target_at", "date", { required: true }), F("completed_at", "date")] }
  ];

  var WORKFLOWS = {
    "default":           { states: ["backlog", "todo", "in_progress", "in_review", "done"], initial: "backlog", close_checks: ["docs_reconciled"] },
    "orvcle_production": { states: ["writing", "recording", "mix", "master", "termine"], initial: "writing", close_checks: [] },
    "orvcle_request":    { states: ["nouvelle", "en_cours_traitement", "convertie"], initial: "nouvelle", close_checks: [], rejects: ["refusee", "expiree"] }
  };

  var ROLES = { viewer: 1, member: 2, admin: 3, owner: 4 };

  /* — entities: [id, type, data, scope_parent_id] — */
  var E = [
    ["ORG_numu",   "workspace", { name: "numu", slug: "numu", status: "active", default_currency: "EUR" }, null],
    ["ORG_orvcle", "workspace", { name: "orvcle-studio", slug: "orvcle", status: "active", default_currency: "EUR" }, null],

    ["USR_jm",   "user", { display_name: "Jean Mensah", handle: "jm", email: "jm@numu.dev", kind: "human", status: "active", attributes: { platform_role: "admin" } }, null],
    ["USR_marc", "user", { display_name: "Marc Okoro", handle: "marc", kind: "human", status: "active", attributes: { specialty: "mix", contract: "salarie" } }, null],
    ["USR_nova", "user", { display_name: "NOVA", handle: "nova", kind: "human", status: "active", attributes: { artist_name: "NOVA", genre: "Alt-R&B" } }, null],
    ["USR_kessy","user", { display_name: "KESSY", handle: "kessy", kind: "human", status: "active", attributes: { artist_name: "KESSY" } }, null],

    ["ADR_sa", "address", { subject_id: "ORG_orvcle", kind: "venue", line1: "Studio A", city: "Paris", country: "FR", attributes: { capacity: 6 } }, "ORG_orvcle"],
    ["ADR_sb", "address", { subject_id: "ORG_orvcle", kind: "venue", line1: "Studio B", city: "Paris", country: "FR", attributes: { capacity: 3 } }, "ORG_orvcle"],

    ["PRJ_a1", "project", { workspace_id: "ORG_orvcle", name: "NOVA — debut EP", slug: "nova-ep", status: "active", origin: "manual", attributes: { channel: "artists", pinned: true } }, "ORG_orvcle"],
    ["PRJ_a2", "project", { workspace_id: "ORG_orvcle", name: "KESSY — single", slug: "kessy-single", status: "active", origin: "manual", attributes: { channel: "artists" } }, "ORG_orvcle"],
    ["PRJ_a3", "project", { workspace_id: "ORG_orvcle", name: "Studio A — 12 Jul", slug: "studio-a-12jul", status: "active", origin: "manual", attributes: { channel: "sessions" } }, "ORG_orvcle"],
    ["PRJ_a4", "project", { workspace_id: "ORG_orvcle", name: "FW26 EP — master", slug: "fw26-master", status: "active", origin: "manual", attributes: { channel: "releases" } }, "ORG_orvcle"],
    ["PRJ_q",  "project", { workspace_id: "ORG_orvcle", name: "Réservations entrantes", slug: "inbox", status: "active", origin: "web", attributes: { channel: "sessions", queue: true } }, "ORG_orvcle"],

    ["CAS_m1", "case", { project_id: "PRJ_a1", title: "midnight-run — mix", type: "task", status: "mix", workflow_id: "orvcle_production", assignee_id: "USR_marc", attributes: { track: 1 } }, "PRJ_a1"],
    ["CAS_m2", "case", { project_id: "PRJ_a1", title: "lowlight — recording", type: "task", status: "recording", workflow_id: "orvcle_production", attributes: { track: 2 } }, "PRJ_a1"],
    ["CAS_r1", "case", { project_id: "PRJ_q", title: "Demande — Léa · premier EP", type: "request", status: "nouvelle", workflow_id: "orvcle_request", origin: "web", reporter_id: "USR_nova", description: "semaine du 20 juil · enregistrement voix" }, "PRJ_q"],

    ["BKG_s1", "booking", { workspace_id: "ORG_orvcle", name: "Recording — Studio A", kind: "session", starts_at: "2026-07-12T14:00", ends_at: "2026-07-12T18:00", status: "confirmed", address_id: "ADR_sa", subject_id: "PRJ_a1", attributes: { code: "SES_118" } }, "ORG_orvcle"],
    ["BKG_h1", "booking", { workspace_id: "ORG_orvcle", name: "Marc — disponible", kind: "hold", starts_at: "2026-07-12T10:00", ends_at: "2026-07-12T20:00", status: "confirmed", subject_id: "USR_marc", attributes: { recurrence: "weekdays" } }, "ORG_orvcle"],

    ["TXN_p1", "transaction", { workspace_id: "ORG_orvcle", kind: "payout", status: "settled", amount: 184000, currency: "EUR", party_id: "USR_nova" }, "ORG_orvcle"],

    ["CAS_b1", "case", { project_id: "PRJ_b1", title: "Add Payout flow", type: "feature", status: "in_review", workflow_id: "default" }, "PRJ_b1"],
    ["PRJ_b1", "project", { workspace_id: "ORG_numu", name: "Add Payout type", slug: "payout-type", status: "active", origin: "manual", attributes: { channel: "build", pinned: true } }, "ORG_numu"],
    ["PRJ_b2", "project", { workspace_id: "ORG_numu", name: "RBAC reach audit", slug: "rbac-audit", status: "active", origin: "manual", attributes: { channel: "build" } }, "ORG_numu"]
  ];
    /* media files (ORVCLE demo) — registry rows so read:file.type=mp3 is a real reach-filtered SELECT.
       consoleRef points at the console kit's viewer object; no blob (metadata-only). */
    E.push(
      ["FIL_o1", "file", { project_id: "PRJ_a1", filename: "nova-midnight-run.wav", file_type: "audio", attributes: { consoleRef: "o1", icon: "music-note-beamed", accent: "var(--chart-3)", meta: "NOVA · rough mix · 3:48" } }, "PRJ_a1"],
      ["FIL_o2", "file", { project_id: "PRJ_a2", filename: "kessy-lowlight.wav", file_type: "audio", attributes: { consoleRef: "o2", icon: "music-note-beamed", accent: "var(--chart-5)", meta: "KESSY · master v3 · 3:12" } }, "PRJ_a2"],
      ["FIL_o3", "file", { project_id: "PRJ_a3", filename: "studio-A-live.mp4", file_type: "video", attributes: { consoleRef: "o3", icon: "camera-video-fill", accent: "var(--chart-2)", meta: "8:20 · session" } }, "PRJ_a3"],
      ["FIL_o4", "file", { project_id: "PRJ_a1", filename: "EP artwork · NOVA", file_type: "image", attributes: { consoleRef: "o4", icon: "images", accent: "var(--chart-4)", meta: "6 shots" } }, "PRJ_a1"]
    );

  /* memberships: [object_id, member_id, role, context_role] */
  var M = [
    ["ORG_numu", "USR_jm", "owner", "founder"],
    ["ORG_orvcle", "USR_jm", "owner", "operator"],
    ["ORG_orvcle", "USR_marc", "member", "engineer"],
    ["PRJ_a1", "USR_nova", "viewer", "artist"],
    ["PRJ_a2", "USR_kessy", "viewer", "artist"],
    ["BKG_s1", "USR_marc", "member", "engineer"]
  ];

  return { TYPES: TYPES, WORKFLOWS: WORKFLOWS, ROLES: ROLES, ENTITIES: E, MEMBERSHIPS: M };
});

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
    ["USR_jm", "user", { display_name: "Jean Mensah", handle: "jm", email: "jm@numu.dev", kind: "human", status: "active", attributes: { platform_role: "admin" } }, null]
  ];

  /* memberships: [object_id, member_id, role, context_role] */
  var M = [
    ["ORG_numu", "USR_jm", "owner", "founder"],
    ["ORG_orvcle", "USR_jm", "owner", "operator"]
  ];

  return { TYPES: TYPES, WORKFLOWS: WORKFLOWS, ROLES: ROLES, ENTITIES: E, MEMBERSHIPS: M };
});

/* numu-data-client.js — THE SEAM (rewrite-plan R0).
   =============================================================================
   One client interface, two impls. The whole App renders off this interface so
   that swapping fixtures → live `fetch` is a one-line change with zero UI churn.

     makeClient("fixture")  → FixtureClient  (contract-shaped, offline; build on this)
     makeClient("http")     → HttpClient     (fetch /api/*, when the server is up)

   Every method is async (so fixtures and http are interchangeable) and returns
   shapes copied from the REAL catalog — `type_definitions` + `type_fields` as I
   read them in the repo migrations (0011/0014/0016). OPTIONS is the renderer's
   schema source; list/get drive list+detail; feed/upload/run are later phases.
   =============================================================================*/
(function () {
  // ── the catalog (real shapes; fields mirror type_fields rows) ──────────────
  // field.kind = storage/input (text|enum|ref|int|bool|json|date); options.role
  // = PRESENTATION role the renderer reads (title|subtitle|status|metric|…).
  var CATALOG = {
    project: {
      type: "project", idPrefix: "PRJ", displayName: "Conversation", displayNamePlural: "Conversations",
      contextView: "thread", scopeParents: ["workspace_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "origin", label: "Origin", kind: "enum", required: true, editable: false, options: { enum: ["manual", "email", "case", "connector"], role: "subtitle" } },
        { field: "status", label: "Status", kind: "enum", required: true, editable: true, options: { enum: ["active", "archived"], default: "active", role: "status" } },
        { field: "channel_group", label: "Channel", kind: "text", required: false, editable: true, options: {} }
      ],
      verbs: ["read", "create", "update", "delete"]
    },
    case: {
      type: "case", idPrefix: "CAS", displayName: "Case", displayNamePlural: "Cases",
      contextView: "board", scopeParents: ["project_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "status", label: "Status", kind: "enum", required: true, editable: true, options: { enum: ["backlog", "in_review", "blocked", "done"], default: "backlog", role: "status" } },
        { field: "priority", label: "Priority", kind: "enum", required: false, editable: true, options: { enum: ["normal", "urgent"], default: "normal" } },
        { field: "assignee_id", label: "Assignee", kind: "ref", required: false, editable: true, options: { ref: "USR", role: "subtitle" } }
      ],
      verbs: ["read", "create", "update", "transition", "close"]
    },
    file: {
      type: "file", idPrefix: "FIL", displayName: "File", displayNamePlural: "Files",
      contextView: "table", scopeParents: ["project_id"],
      fields: [
        { field: "filename", label: "Filename", kind: "text", required: true, editable: false, options: { role: "title" } },
        { field: "encoding", label: "Encoding", kind: "text", required: false, editable: false, options: {} },
        { field: "row_count", label: "Rows", kind: "int", required: false, editable: false, options: {} },
        { field: "col_count", label: "Columns", kind: "int", required: false, editable: false, options: {} },
        { field: "cleanness", label: "Cleanness", kind: "int", required: false, editable: false, options: { role: "metric" } }
      ],
      verbs: ["read", "create", "delete"]
    },
    message: {
      type: "message", idPrefix: "MSG", displayName: "Message", displayNamePlural: "Messages",
      contextView: "thread", scopeParents: ["project_id"],
      fields: [
        { field: "body", label: "Body", kind: "text", required: false, editable: true, options: { role: "title" } },
        { field: "channel", label: "Channel", kind: "enum", required: true, editable: false, options: { enum: ["chat", "sms", "email", "voice", "note"], default: "chat" } },
        { field: "direction", label: "Direction", kind: "enum", required: false, editable: false, options: { enum: ["in", "out"], default: "out", role: "subtitle" } },
        { field: "visibility", label: "Visibility", kind: "enum", required: true, editable: true, options: { enum: ["public", "internal"], default: "public", role: "status" } }
      ],
      verbs: ["read", "create", "update", "delete"]
    },
    chart: {
      type: "chart", idPrefix: "CHT", displayName: "Chart", displayNamePlural: "Charts",
      contextView: "chart", scopeParents: ["project_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "chart_type", label: "Type", kind: "enum", required: true, editable: true, options: { enum: ["bar", "line", "area", "pie", "donut"], default: "bar", role: "subtitle" } },
        { field: "spec", label: "Spec", kind: "json", required: true, editable: false, options: {} }
      ],
      verbs: ["read", "create", "update", "delete"]
    },
    dashboard: {
      type: "dashboard", idPrefix: "DSH", displayName: "Dashboard", displayNamePlural: "Dashboards",
      contextView: "dashboard", scopeParents: ["project_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "spec", label: "Layout", kind: "json", required: true, editable: false, options: {} }
      ],
      verbs: ["read", "create", "update", "delete"]
    },
    track: {
      type: "track", idPrefix: "TRK", displayName: "Track", displayNamePlural: "Tracks", contextView: "media", scopeParents: ["release_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "artist", label: "Artist", kind: "text", required: false, editable: true, options: { role: "subtitle" } },
        { field: "duration", label: "Duration", kind: "text", required: false, editable: false, options: {} },
        { field: "audio_url", label: "Audio", kind: "text", required: false, editable: false, options: { role: "media_url" } }
      ], verbs: ["read", "update"]
    },
    release: {
      type: "release", idPrefix: "REL", displayName: "Release", displayNamePlural: "Releases", contextView: "collection", scopeParents: ["workspace_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "cover_image", label: "Cover", kind: "text", required: false, editable: false, options: { role: "cover" } },
        { field: "tracks", label: "Tracks", kind: "json", required: false, editable: false, options: {} }
      ], verbs: ["read", "update"]
    },
    session: {
      type: "session", idPrefix: "SES", displayName: "Session", displayNamePlural: "Sessions", contextView: "calendar", scopeParents: ["workspace_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "starts_at", label: "Starts", kind: "date", required: true, editable: true, options: { role: "starts_at" } },
        { field: "location", label: "Location", kind: "text", required: false, editable: true, options: {} }
      ], verbs: ["read", "update"]
    },
    post: {
      type: "post", idPrefix: "PST", displayName: "Post", displayNamePlural: "Posts", contextView: "preview", scopeParents: ["workspace_id"],
      fields: [
        { field: "title", label: "Title", kind: "text", required: true, editable: true, options: { role: "title" } },
        { field: "platform", label: "Platform", kind: "enum", required: true, editable: true, options: { enum: ["instagram", "x", "tiktok"], role: "subtitle" } },
        { field: "status", label: "Status", kind: "enum", required: true, editable: true, options: { enum: ["draft", "scheduled", "live"], default: "draft", role: "status" } },
        { field: "body", label: "Body", kind: "text", required: false, editable: true, options: {} }
      ], verbs: ["read", "update"]
    }
  };

  // ── seeded entities (a real-feeling FR data domain, matching the mock) ──────
  var ENTITIES = {
    project: [
      { id: "PRJ_3f21", type: "project", title: "Client cleanup — Maison Rets", origin: "email", status: "active", channel_group: "Clients", _version: "1" },
      { id: "PRJ_7a09", type: "project", title: "Assistance dossier Q1", origin: "case", status: "active", channel_group: "Clients", _version: "4" },
      { id: "PRJ_0c14", type: "project", title: "Internal — fleet health", origin: "manual", status: "active", channel_group: "Internal", _version: "2" }
    ],
    case: [
      { id: "CAS_277d", type: "case", title: "Encoding garbled on import", status: "in_review", priority: "urgent", assignee_id: "USR_jordan", _version: "6" },
      { id: "CAS_4f2a", type: "case", title: "Duplicate rows after join", status: "backlog", priority: "normal", assignee_id: "USR_sam", _version: "1" },
      { id: "CAS_91ks", type: "case", title: "Pivot over dirty column", status: "done", priority: "normal", assignee_id: "USR_jordan", _version: "9" }
    ],
    file: [
      { id: "FIL_d055", type: "file", filename: "dossier.csv", encoding: "windows-1252", row_count: 1000, col_count: 20, fully_null_rows: 3, size_bytes: 184320, cleanness: 62, _version: "1",
        columns_meta: [
          { name: "Formule", dtype: "string", semantic_dtype: "string", null_pct: 0, unique_pct: 0.5, sample: "F4" },
          { name: "Cause.intervention", dtype: "string", semantic_dtype: "string", null_pct: 3, unique_pct: 1.2, sample: "Panne" },
          { name: "Type.d.energie", dtype: "string", semantic_dtype: "string", null_pct: 1, unique_pct: 0.4, sample: "Diesel" },
          { name: "Montant", dtype: "string", semantic_dtype: "float", null_pct: 8, unique_pct: 64.0, sample: "1 234,56" },
          { name: "date.ouverture", dtype: "string", semantic_dtype: "date", null_pct: 0, unique_pct: 88.0, sample: "03/02/2026" }
        ] },
      { id: "FIL_7e2c", type: "file", filename: "temps.csv", encoding: "utf-8", row_count: 365, col_count: 4, fully_null_rows: 0, size_bytes: 9216, cleanness: 94, _version: "1",
        columns_meta: [
          { name: "jour", dtype: "date", semantic_dtype: "date", null_pct: 0, unique_pct: 100.0, sample: "2026-01-01" },
          { name: "tmin", dtype: "float", semantic_dtype: "float", null_pct: 0, unique_pct: 42.0, sample: "-3.2" },
          { name: "tmax", dtype: "float", semantic_dtype: "float", null_pct: 0, unique_pct: 47.0, sample: "8.6" }
        ] }
    ],
    chart: [
      { id: "CHT_11", type: "chart", title: "Interventions par formule", chart_type: "bar", _version: "1",
        spec: { type: "bar", cats: [ { label: "F4", value: 185 }, { label: "F1", value: 142 }, { label: "F99", value: 96 }, { label: "F21", value: 73 }, { label: "F14", value: 51 } ] } },
      { id: "CHT_12", type: "chart", title: "Répartition énergie", chart_type: "donut", _version: "1",
        spec: { type: "donut", cats: [ { label: "Essence", value: 410 }, { label: "Diesel", value: 330 }, { label: "Électrique", value: 180 }, { label: "???", value: 80 } ] } }
    ],
    dashboard: [
      { id: "DSH_01", type: "dashboard", title: "Assistance — Q1 review", _version: "1",
        spec: { tiles: [ { chart_id: "CHT_11" }, { chart_id: "CHT_12" } ] } }
    ],
    track: [
      { id: "TRK_a1", type: "track", title: "Nuit Blanche", artist: "Loräs", duration: "3:42", audio_url: "https://example.com/a.mp3" },
      { id: "TRK_a2", type: "track", title: "Ond­es", artist: "Loräs", duration: "4:08", audio_url: "https://example.com/b.mp3" }
    ],
    release: [
      { id: "REL_01", type: "release", title: "Marées — EP", cover_image: "", tracks: [ { title: "Nuit Blanche", duration: "3:42" }, { title: "Ondes", duration: "4:08" }, { title: "Rivage", duration: "5:11" } ] }
    ],
    session: [
      { id: "SES_01", type: "session", title: "Mix — Studio A", starts_at: "2026-07-03 14:00", location: "Studio A" },
      { id: "SES_02", type: "session", title: "Mastering review", starts_at: "2026-07-05 10:30", location: "Remote" }
    ],
    post: [
      { id: "PST_01", type: "post", title: "EP drop teaser", platform: "instagram", status: "scheduled", body: "Marées is almost here. 07.10 ✦" }
    ],
    message: [
      { id: "MSG_a1", type: "message", body: "Voici le fichier à nettoyer, merci !", channel: "email", direction: "in", visibility: "public", _version: "1" },
      { id: "MSG_a2", type: "message", body: "repro'd on api v1.8.0 — encoding sniff misfires", channel: "note", direction: "out", visibility: "internal", _version: "1" },
      { id: "MSG_a3", type: "message", body: "Cleaned + dashboard attached. Please confirm.", channel: "email", direction: "out", visibility: "public", _version: "1" }
    ]
  };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 40); }); }

  // ── FixtureClient — the offline, contract-shaped impl ──────────────────────
  function FixtureClient() {}
  FixtureClient.prototype.types = function () {
    return delay(Object.keys(CATALOG).map(function (t) {
      return { type: t, displayName: CATALOG[t].displayName, displayNamePlural: CATALOG[t].displayNamePlural, idPrefix: CATALOG[t].idPrefix, contextView: CATALOG[t].contextView };
    }));
  };
  FixtureClient.prototype.options = function (type) {
    var c = CATALOG[type]; if (!c) return Promise.reject(new Error("unknown type " + type));
    return delay(clone(c));
  };
  FixtureClient.prototype.list = function (type, q) {
    q = q || {}; var rows = (ENTITIES[type] || []).slice();
    if (q.query) { var s = String(q.query).toLowerCase(); rows = rows.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(s) >= 0; }); }
    var total = rows.length, off = q.offset || 0, lim = q.limit || 50;
    return delay({ rows: clone(rows.slice(off, off + lim)), total: total });
  };
  FixtureClient.prototype.get = function (type, id) {
    var row = (ENTITIES[type] || []).find(function (r) { return r.id === id; });
    return row ? delay(clone(row)) : Promise.reject(new Error("not found " + id));
  };
  FixtureClient.prototype.create = function (type, data) {
    var c = CATALOG[type]; if (!c) return Promise.reject(new Error("unknown type " + type));
    var id = c.idPrefix + "_" + Math.random().toString(36).slice(2, 6);
    var row = Object.assign({ id: id, type: type, _version: "1" }, data);
    (ENTITIES[type] = ENTITIES[type] || []).unshift(row);
    return delay(clone(row));
  };
  FixtureClient.prototype.update = function (type, id, patch) {
    var row = (ENTITIES[type] || []).find(function (r) { return r.id === id; });
    if (!row) return Promise.reject(new Error("not found " + id));
    Object.assign(row, patch); row._version = String((+row._version || 1) + 1);
    return delay(clone(row));
  };
  // ── feed: a conversation's timeline (messages ∪ artifacts ∪ events), lens-filtered ───
  // Real shape (conversations.rs): items carry top-level {id,kind,at,visibility,author} + a nested `data`
  // payload. kind ∈ file·chart·dashboard·message·event. A NOTE is a message with channel=note +
  // visibility=internal; a STEP is an event. The lens is a WHERE on `visibility` (leak-free).
  var FEED = {
    PRJ_3f21: [
      { id: "MSG_b1", kind: "message", at: "09:02", visibility: "public", author: "client@maison-rets.fr", data: { channel: "email", direction: "in", body: "Voici le fichier à nettoyer, merci !" } },
      { id: "FIL_d055", kind: "file", at: "09:05", visibility: "public", author: "jordan", data: { filename: "dossier.csv", cleanness: 62, col_count: 20, fully_null_rows: 3 } },
      { id: "MSG_b3", kind: "message", at: "09:14", visibility: "internal", author: "jordan", data: { channel: "note", direction: "out", body: "encoding is windows-1252 — repair before anything" } },
      { id: "EVT_b4", kind: "event", at: "09:15", visibility: "internal", author: "jordan", data: { event: "step.applied", payload: { qir: "repair", impact: "mojibake fixed · 1,000 rows" } } },
      { id: "CHT_11", kind: "chart", at: "10:20", visibility: "public", author: "jordan", data: { title: "Interventions par formule" } },
      { id: "MSG_b6", kind: "message", at: "11:40", visibility: "public", author: "jordan", data: { channel: "email", direction: "out", body: "Cleaned + a first chart attached. Confirm the grouping?" } }
    ]
  };
  FixtureClient.prototype.conversations = function () {
    return delay((ENTITIES.project || []).map(function (p) { return { id: p.id, title: p.title, origin: p.origin, channel: p.channel_group || "Clients", status: p.status }; }));
  };
  FixtureClient.prototype.feed = function (convId, q) {
    var lens = (q && q.lens) || "all";
    var items = (FEED[convId] || []).filter(function (b) {
      if (lens === "customer") return b.visibility !== "internal";
      if (lens === "mine") return b.author === "jordan";
      return true;
    });
    return delay({ conversation: convId, lens: lens, items: clone(items), limit: 100, offset: 0 });
  };
  // later-phase stubs (R4): keep the interface complete + honest
  FixtureClient.prototype.upload = function (filename, project) {
    // Offline stand-in for POST /api/files → UploadOutcome. Looks up a seeded `file`
    // entity by filename and returns the real outcome shape (rows live in the client
    // data store — NUMU_DATA here, GlueSQL live — not in the outcome).
    var f = (ENTITIES.file || []).find(function (r) { return r.filename === filename || r.filename === filename + ".csv"; });
    if (!f) return Promise.reject(new Error("no seeded file '" + filename + "'"));
    return delay({ rid: f.id, filename: f.filename, encoding: f.encoding, cleanness: f.cleanness,
      fully_null_rows: f.fully_null_rows || 0, size_bytes: f.size_bytes || 0, columns: clone(f.columns_meta || []) });
  };
  FixtureClient.prototype.run = function () { return Promise.reject(new Error("run: fixture stub — see R4")); };
  // ── recordCheck: offline stand-in for POST /api/objects/case/:id/checks/:name (members.rs:35) ──
  // (CASE 0019 console-cutover, AC20). Marks a close-check on the seeded case so the board archetype's
  // close-gate can advance offline; live, the HttpClient POSTs to the checks route.
  FixtureClient.prototype.recordCheck = function (caseId, name) {
    var row = (ENTITIES.case || []).find(function (r) { return r.id === caseId; });
    if (!row) return Promise.reject(new Error("not found " + caseId));
    row.checks = row.checks || {}; row.checks[name] = true;
    return delay({ case_id: caseId, name: name, ok: true });
  };
  // ── search: offline stand-in for GET /api/search?q= → {query,results:[{entity_id,type,title,rank}]} ──
  // (CASE 0019 console-cutover, AC21). Scans the seeded ENTITIES for a substring match on the title-ish
  // fields and returns the live result shape so the TopBar can route via AC7's archetype dispatch.
  FixtureClient.prototype.search = function (q) {
    var s = String(q || "").trim().toLowerCase();
    if (!s) return delay({ query: "", results: [] });
    var results = [];
    Object.keys(ENTITIES).forEach(function (type) {
      (ENTITIES[type] || []).forEach(function (r) {
        var title = r.title || r.filename || r.body || r.id;
        if (String(title).toLowerCase().indexOf(s) >= 0) {
          results.push({ entity_id: r.id, type: type, title: title, rank: 0.5 });
        }
      });
    });
    return delay({ query: s, results: results });
  };

  // ── HttpClient — the live impl (maps 1:1 to CONTRACT.md/HTTP.md) ───────────
  // Won't reach a server inside a sandboxed preview (cross-origin); it documents
  // and IS the real binding — same-origin in the dev env, it just works.
  //
  // CASE 0013 (G3–G6): the backend speaks an enveloped {id,type,data,version,etag}
  // wire shape; the fixture-built UI consumes flat {…fields…, _version}. ONE shared
  // flatten() bridges the two so list/get/create/update/conversations are shape-
  // identical to FixtureClient — normalization happens on the RESULT of _get/_send.
  function flatten(entity) {
    // {id,type,data:{…},version,etag} ⇒ {id, type, …data, _version: String(version)}.
    // _version is a STRING (matches FixtureClient + the If-Match round-trip in update()).
    return Object.assign(
      { id: entity.id, type: entity.type },
      entity.data,
      { _version: String(entity.version) }
    );
  }
  // G5: backend snake_case type descriptor ⇒ the camelCase the renderer reads.
  // `fields` passes through unchanged (already shape-compatible, incl. options.role).
  function mapType(t) {
    return {
      type: t.type_id,
      idPrefix: t.id_prefix,
      displayName: t.display_name,
      displayNamePlural: t.display_name_plural,
      contextView: t.context_view,
      scopeParents: t.scope_parents,
      fields: t.fields
    };
  }
  function HttpClient(base) { this.base = base || ""; }
  HttpClient.prototype._get = function (path) {
    return fetch(this.base + path, { credentials: "include", headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status + " " + path); return r.json(); });
  };
  HttpClient.prototype.types = function () {
    // GET /api/types → {types:[<snake descriptor>,…]} ⇒ [<camel descriptor>,…] (G5).
    return this._get("/api/types").then(function (resp) { return (resp.types || []).map(mapType); });
  };
  HttpClient.prototype.options = function (type) { // GET /api/types/:type (static schema); OPTIONS /api/objects/:type adds per-caller verbs+RBAC
    // single snake descriptor ⇒ single camel descriptor (G5).
    return this._get("/api/types/" + type).then(mapType);
  };
  HttpClient.prototype.feedDescribe = function (type) { return this._get("/api/types/" + type); };
  HttpClient.prototype.list = function (type, q) {
    q = q || {}; var p = []; if (q.query) p.push("q=" + encodeURIComponent(q.query));
    if (q.limit) p.push("limit=" + q.limit); if (q.offset) p.push("offset=" + q.offset);
    // {items,limit,offset} ⇒ {rows: items.map(flatten), total: items.length} (G3).
    // total is the PAGE count (the backend list carries no grand total).
    return this._get("/api/objects/" + type + (p.length ? "?" + p.join("&") : ""))
      .then(function (resp) { return { rows: (resp.items || []).map(flatten), total: (resp.items || []).length }; });
  };
  HttpClient.prototype.get = function (type, id) { return this._get("/api/objects/" + type + "/" + id).then(flatten); };
  HttpClient.prototype.create = function (type, data) { return this._send("POST", "/api/objects/" + type, data).then(flatten); };
  HttpClient.prototype.update = function (type, id, patch, version) { return this._send("PATCH", "/api/objects/" + type + "/" + id, patch, version).then(flatten); };
  HttpClient.prototype._send = function (method, path, body, version) {
    var h = { "content-type": "application/json", accept: "application/json" };
    if (version) h["If-Match"] = 'W/"' + version + '"';
    return fetch(this.base + path, { method: method, credentials: "include", headers: h, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error(r.status + " " + path); return r.json(); });
  };
  HttpClient.prototype.conversations = function () {
    // GET /api/objects/project envelope ⇒ the conversation projection [{id,title,origin,channel,status}] (G6).
    // title = data.title || data.name (live project's label field is `name`); channel = data.channel_group
    // || "Clients" (no channel_group field on the live project — fall back to the fixture default here, not
    // in the UI). `var d = it.data || {}` guards a null `data` so a malformed item yields a sane row, not a throw.
    return this._get("/api/objects/project?origin=email,case,connector,manual").then(function (resp) {
      return (resp.items || []).map(function (it) {
        var d = it.data || {};
        return { id: it.id, title: d.title || d.name, origin: d.origin, channel: d.channel_group || "Clients", status: d.status };
      });
    });
  };
  HttpClient.prototype.feed = function (convId, q) {
    var p = "lens=" + ((q && q.lens) || "all");
    if (q && q.limit) p += "&limit=" + q.limit; if (q && q.offset) p += "&offset=" + q.offset;
    return this._get("/api/conversations/" + convId + "/feed?" + p);
  };
  // POST /api/files — real multipart upload → UploadOutcome (files.rs). `file` is a Blob/File.
  HttpClient.prototype.upload = function (file, project, tld) {
    var fd = new FormData();
    fd.append("file", file, (file && file.name) || "upload.csv");
    fd.append("project", project);
    if (tld) fd.append("tld", tld);
    return fetch(this.base + "/api/files", { method: "POST", credentials: "include", body: fd })
      .then(function (r) { if (!r.ok) throw new Error(r.status + " /api/files"); return r.json(); });
  };
  // POST /api/connectors/:id/run — the http_json connector run path (connectors.rs:23).
  // `args` is the run payload; returns the connector's run result envelope as-is.
  HttpClient.prototype.run = function (id, args) { return this._send("POST", "/api/connectors/" + id + "/run", args || {}); };
  // POST /api/objects/case/:id/checks/:name — record a case close-check (members.rs:35).
  // (CASE 0019 console-cutover, AC20). The body is empty; the route keys off the path segments.
  HttpClient.prototype.recordCheck = function (caseId, name) {
    return this._send("POST", "/api/objects/case/" + encodeURIComponent(caseId) + "/checks/" + encodeURIComponent(name), {});
  };
  // GET /api/search?q=<term> → {query, results:[{entity_id,type,title,rank}]} (search.rs:78–85).
  // (CASE 0019 console-cutover, AC21). Surfaces the results array for TopBar → AC7 archetype routing.
  // An empty/blank q is NOT sent (the backend 400s on blank — search.rs:47); returns an empty result set.
  HttpClient.prototype.search = function (q) {
    var s = String(q || "").trim();
    if (!s) return Promise.resolve({ query: "", results: [] });
    return this._get("/api/search?q=" + encodeURIComponent(s));
  };

  window.NUMU_CLIENT = {
    makeClient: function (mode) { return mode === "http" ? new HttpClient() : new FixtureClient(); },
    FixtureClient: FixtureClient, HttpClient: HttpClient, _catalog: CATALOG
  };

  // ── AutoClient — R6 cutover seam ───────────────────────────────────────────
  // Probes the live API once; if reachable (same-origin server up), every call
  // delegates to HttpClient — else to FixtureClient. So the SAME app code uses
  // real data the moment the backend is serving, and falls back offline (the
  // preview) with zero change. This is the "one switch" R6 promised.
  function AutoClient(base) {
    this.http = new HttpClient(base); this.fix = new FixtureClient(); this.live = null;
    var self = this;
    this.ready = fetch((base || "") + "/api/health", { credentials: "include" })
      .then(function (r) { self.live = r.ok; }).catch(function () { self.live = false; });
  }
  ["types", "options", "list", "get", "create", "update", "feed", "conversations", "upload", "run", "search", "recordCheck"].forEach(function (m) {
    AutoClient.prototype[m] = function () {
      var args = arguments, self = this;
      return this.ready.then(function () {
        var impl = self.live ? self.http : self.fix;
        return impl[m].apply(impl, args);
      });
    };
  });
  AutoClient.prototype.isLive = function () { return this.ready.then(function () {}.bind(this)).then((function () { return this.live; }).bind(this)); };

  window.NUMU_CLIENT.makeClient = function (mode) {
    if (mode === "http") return new HttpClient();
    if (mode === "auto") return new AutoClient();
    return new FixtureClient();
  };
  window.NUMU_CLIENT.AutoClient = AutoClient;
})();

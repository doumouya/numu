/* numu-sim · numu-engine.js — the generic object service (transport-agnostic).
   One dispatcher `handle(req)` both drivers share (browser-local and Node HTTP).
   Faithful to docs: two-plane RBAC (reach→leak-free 404, fields→403), roles-as-
   data rank ladder, ETag/If-Match (428/412), workflow guard (422), events rows,
   OPTIONS self-describe, reach-filtered list/search, feed, one-write-path CSV
   upload + steps (derive-don't-store).                                        */
(function (root, factory) {
  var Csv = (typeof module !== "undefined" && typeof require === "function") ? require("./numu-csv.js") : root.NumuCsv;
  var Seed = (typeof module !== "undefined" && typeof require === "function") ? require("./numu-seed.js") : root.NumuSeed;
  var mod = factory(Csv, Seed);
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  root.NumuEngine = mod;
})(typeof window !== "undefined" ? window : globalThis, function (Csv, Seed) {

  var FLOORS = { View: 1, Create: 2, Edit: 2, Delete: 3 };
  var PERM = { standard: { r: 1, w: 2 }, owner_grade: { r: 3, w: 4 }, readonly: { r: 1, w: 99 }, system: { r: 1, w: 99 } };

  function Engine(opts) {
    opts = opts || {};
    this.blobs = opts.blobStore || memBlobStore();
    this.persist = opts.persist || null;
    this.tables = {};                                   // derived frames, NEVER persisted
    var saved = this.persist && this.persist.load();
    if (saved && saved.entities) { this.state = saved; }
    else {
      var st = { entities: {}, memberships: [], events: [], feeds: {}, seq: 1 };
      Seed.ENTITIES.forEach(function (e) {
        st.entities[e[0]] = { id: e[0], type: e[1], data: e[2], scope_parent_id: e[3], version: 1,
          created_at: "2026-07-01T09:00:00Z", created_by: "USR_jm", updated_at: "2026-07-01T09:00:00Z" };
      });
      Seed.MEMBERSHIPS.forEach(function (m) { st.memberships.push({ object_id: m[0], member_id: m[1], role: m[2], context_role: m[3] }); });
      this.state = st;
    }
    this.typeById = {}; this.typeByPrefix = {};
    var self = this;
    Seed.TYPES.forEach(function (t) { self.typeById[t.type_id] = t; self.typeByPrefix[t.id_prefix] = t; });
  }

  function memBlobStore() { var m = {}; return { save: function (k, v) { m[k] = v; }, load: function (k) { return m[k]; }, has: function (k) { return k in m; } }; }
  function json(status, body, headers) { return { status: status, body: body, headers: headers || {} }; }
  function problem(status, code, detail) { return json(status, { type: code, status: status, detail: detail || code }); }

  var P = Engine.prototype;

  P.save = function () {
    if (!this.persist) return;
    // derive-don't-store: strip nothing else — blobs/tables live outside state
    try { this.persist.save(this.state); } catch (e) { /* quota: sim keeps running in memory */ }
  };
  P.mint = function (prefix) { return prefix + "_" + (this.state.seq++).toString(36) + Math.random().toString(16).slice(2, 6); };
  P.event = function (entity_id, actor, kind, payload) {
    this.state.events.push({ id: this.state.events.length + 1, entity_id: entity_id, actor_id: actor, kind: kind,
      at: new Date().toISOString(), payload: payload || {}, request_id: "req_" + Math.random().toString(16).slice(2, 8) });
  };

  /* ── RBAC · Plane A: reach ────────────────────────────────────────────── */
  P.isPlatformAdmin = function (actor) {
    var u = this.state.entities[actor];
    return !!(u && u.data && u.data.attributes && u.data.attributes.platform_role === "admin");
  };
  P.principals = function (actor) {
    var ids = [actor], st = this.state;
    st.memberships.forEach(function (m) {
      var obj = st.entities[m.object_id];
      if (m.member_id === actor && obj && obj.type === "team") ids.push(m.object_id);
    });
    return ids;
  };
  P.scopeChain = function (id) {
    var chain = [], seen = {}, cur = id, st = this.state, depth = 0;
    while (cur && !seen[cur] && depth < 8) { seen[cur] = 1; chain.push(cur); var e = st.entities[cur]; cur = e ? e.scope_parent_id : null; depth++; }
    return chain;
  };
  P.effectiveRank = function (actor, objectId) {
    if (this.isPlatformAdmin(actor)) return 99;
    var pr = this.principals(actor), chain = this.scopeChain(objectId), best = 0;
    this.state.memberships.forEach(function (m) {
      if (chain.indexOf(m.object_id) !== -1 && pr.indexOf(m.member_id) !== -1) best = Math.max(best, Seed.ROLES[m.role] || 0);
    });
    return best;
  };
  P.reachable = function (actor, type) {
    var out = [], st = this.state, self = this;
    Object.keys(st.entities).forEach(function (id) {
      var e = st.entities[id];
      if (type && e.type !== type) return;
      if (self.effectiveRank(actor, id) >= FLOORS.View) out.push(e);
    });
    return out;
  };

  /* ── RBAC · Plane B: fields ───────────────────────────────────────────── */
  P.fieldDef = function (type, field) { var t = this.typeById[type]; return t && t.fields.find(function (f) { return f.field === field; }); };
  P.filterReadable = function (actor, e) {
    var rank = this.effectiveRank(actor, e.id), t = this.typeById[e.type], out = {};
    if (!t) return e.data;
    var self = this;
    Object.keys(e.data).forEach(function (k) {
      var def = self.fieldDef(e.type, k), cls = PERM[(def && def.perm_class) || "standard"] || PERM.standard;
      if (rank >= cls.r) out[k] = e.data[k];
    });
    return out;
  };
  P.requireWrite = function (actor, e, body) {
    var rank = this.effectiveRank(actor, e.id), self = this;
    for (var k in body) {
      var def = self.fieldDef(e.type, k);
      if (def && def.editable === false && def.perm_class !== "standard") return k;      // readonly/system
      if (def && def.editable === false && e.version > 0 && k in e.data) return k;       // set-once
      var cls = PERM[(def && def.perm_class) || "standard"] || PERM.standard;
      if (rank < cls.w) return k;
    }
    return null;
  };

  /* ── workflow guard (case) ────────────────────────────────────────────── */
  P.checkTransition = function (e, to) {
    if (e.type !== "case") return null;
    var wf = Seed.WORKFLOWS[e.data.workflow_id || "default"];
    if (!wf) return null;
    var from = e.data.status, S = wf.states, fi = S.indexOf(from), ti = S.indexOf(to);
    if ((wf.rejects || []).indexOf(to) !== -1) return null;                              // documented reject exits
    if (ti === -1) return "unknown_state";
    if (fi === -1) return null;
    var terminal = S[S.length - 1];
    var legal = ti === fi + 1 || ti === fi - 1 || (from === terminal && ti !== -1) || ti === fi;
    if (!legal) return "illegal_transition";
    if (to === terminal && (wf.close_checks || []).length) {
      var passed = e.data.attributes && e.data.attributes.close_checks_passed;
      if (!passed) return "close_preconditions_unmet";
    }
    return null;
  };

  /* ── CRUD core ────────────────────────────────────────────────────────── */
  P.createEntity = function (actor, type, body, opts) {
    opts = opts || {};
    var t = this.typeById[type];
    if (!t) return problem(404, "unknown_type");
    var scopeField = t.scope_parents[0], parentId = scopeField ? body[scopeField] : null;
    if (scopeField && !parentId) return problem(422, "validation", scopeField + " is required");
    if (parentId) {
      if (!this.state.entities[parentId]) return problem(404, "not_found");               // FK backstop
      if (!opts.system && this.effectiveRank(actor, parentId) < FLOORS.Create) return problem(404, "not_found"); // leak-free
    }
    var data = {}, self = this;
    t.fields.forEach(function (f) {
      var v = body[f.field];
      if (v == null && f.options && f.options.default != null) v = JSON.parse(JSON.stringify(f.options.default));
      if (f.kind === "enum" && v != null && (f.options.enum || []).length && f.options.enum.indexOf(String(v)) === -1 && !f.options.workflow) v = f.options.default;
      if (v != null) data[f.field] = v;
    });
    var missing = t.fields.filter(function (f) { return f.required && data[f.field] == null; });
    if (missing.length && !opts.system) return problem(422, "validation", "missing: " + missing.map(function (f) { return f.field; }).join(", "));
    if (type === "case" && data.status == null) { var wf = Seed.WORKFLOWS[data.workflow_id || "default"]; data.status = wf ? wf.initial : "backlog"; }
    var id = opts.id || this.mint(t.id_prefix);
    var now = new Date().toISOString();
    this.state.entities[id] = { id: id, type: type, data: data, scope_parent_id: parentId || null, version: 1, created_at: now, created_by: actor, updated_at: now };
    this.state.memberships.push({ object_id: id, member_id: actor, role: "owner", context_role: null }); // no object without an owner
    this.event(id, actor, type + ".created", { data: data });
    this.save();
    return json(201, this.serialize(actor, this.state.entities[id]), { ETag: 'W/"1"' });
  };
  P.serialize = function (actor, e) {
    return { id: e.id, type: e.type, data: this.filterReadable(actor, e), scope_parent_id: e.scope_parent_id,
             version: e.version, created_at: e.created_at, updated_at: e.updated_at };
  };

  /* ── OPTIONS self-describe (the autocomplete manifest per object) ─────── */
  P.describe = function (actor, e) {
    var t = this.typeById[e.type], rank = this.effectiveRank(actor, e.id), self = this;
    var fields = t.fields.map(function (f) {
      var cls = PERM[f.perm_class] || PERM.standard;
      return { field: f.field, kind: f.kind, enum: (f.options && f.options.enum) || null, required: !!f.required,
               can_read: rank >= cls.r, can_write: rank >= cls.w && f.editable !== false, data_class: f.data_class || "none" };
    });
    var wf = e.type === "case" ? Seed.WORKFLOWS[e.data.workflow_id || "default"] : null;
    var allow = ["GET", "HEAD", "OPTIONS"];
    if (rank >= FLOORS.Edit) allow.push("PUT", "PATCH", "POST");
    if (rank >= FLOORS.Delete) allow.push("DELETE");
    return json(200, { type: e.type, id: e.id, allow: allow, rank: rank, etag: 'W/"' + e.version + '"',
                       fields: fields, workflow: wf ? { states: wf.states, rejects: wf.rejects || [] } : null }, { Allow: allow.join(", ") });
  };

  /* ── CSV: one-write-path upload + steps (derive-don't-store) ──────────── */
  P.uploadCsv = function (actor, projectId, filename, csvText, fileType) {
    if (!this.state.entities[projectId] || this.effectiveRank(actor, projectId) < FLOORS.Create) return problem(404, "not_found");
    var blobRef = "files/" + filename.replace(/[^A-Za-z0-9_.-]/g, "_") + ".bin";
    this.blobs.save(blobRef, csvText);
    var parsed = Csv.parse(csvText, {});
    var meta = Csv.summarize(parsed.headers, parsed.rows);
    var score = Csv.cleanness(parsed.headers, parsed.rows, meta);
    var res = this.createEntity(actor, "file", {
      project_id: projectId, filename: filename.replace(/\.csv$/i, ""), file_type: fileType || "csv",
      encoding: parsed.encoding, row_count: parsed.rows.length, col_count: parsed.headers.length,
      cleanness: score.score, columns_meta: meta,
      steps: [{ ordinal: 0, kind: "original", params: {}, cleanness: score.score }], blob_ref: blobRef
    }, { system: true });
    if (res.status !== 201) return res;
    this.tables[res.body.id] = { headers: parsed.headers, rows: parsed.rows };
    return json(201, { rid: res.body.id, filename: res.body.data.filename, encoding: parsed.encoding,
      cleanness: score.score, fully_null_rows: score.fully_null_rows, row_count: parsed.rows.length,
      col_count: parsed.headers.length, columns: meta, wrapped: parsed.wrapped });
  };
  P.getTable = function (fileId) {
    if (this.tables[fileId]) return this.tables[fileId];
    var e = this.state.entities[fileId];
    if (!e || e.type !== "file") return null;
    var blob = this.blobs.load(e.data.blob_ref);
    if (blob == null) return null;
    this.tables[fileId] = Csv.replay(blob, e.data.steps || []);
    return this.tables[fileId];
  };
  P.addStep = function (actor, fileId, kind, params) {
    var e = this.state.entities[fileId];
    if (!e || this.effectiveRank(actor, fileId) < FLOORS.Edit) return problem(404, "not_found");
    var tbl = this.getTable(fileId);
    if (!tbl) return problem(409, "blob_unavailable", "original bytes not loaded on this device");
    var next = Csv.applyStep(tbl, { kind: kind, params: params });
    var meta = Csv.summarize(next.headers, next.rows);
    var score = Csv.cleanness(next.headers, next.rows, meta);
    e.data.steps = (e.data.steps || []).concat([{ ordinal: (e.data.steps || []).length, kind: kind, params: params || {}, cleanness: score.score }]);
    e.data.columns_meta = meta; e.data.cleanness = score.score;
    e.data.row_count = next.rows.length; e.data.col_count = next.headers.length;
    e.version++; e.updated_at = new Date().toISOString();
    this.tables[fileId] = { headers: next.headers, rows: next.rows };
    this.event(fileId, actor, "file.step_applied", { kind: kind, params: params, cleanness: score.score, affected: next.lastAffected });
    this.save();
    return json(200, { rid: fileId, kind: kind, cleanness: score.score, row_count: next.rows.length,
      col_count: next.headers.length, columns: meta, affected: next.lastAffected });
  };

  /* ── feed ─────────────────────────────────────────────────────────────── */
  P.feedOf = function (key) { return this.state.feeds[key] || (this.state.feeds[key] = []); };
  P.appendFeed = function (key, blocks) { var f = this.feedOf(key); blocks.forEach(function (b) { f.push(b); }); this.save(); return f; };

  /* ── the dispatcher ───────────────────────────────────────────────────── */
  P.handle = function (req) {
    var m = req.method.toUpperCase(), path = req.path.replace(/\/+$/, ""), q = req.query || {}, body = req.body || {};
    var actor = (req.headers && (req.headers["x-numu-actor"] || req.headers["X-Numu-Actor"])) || req.actor || "USR_jm";
    var seg = path.split("/").filter(Boolean);           // ["api", ...]
    if (seg[0] !== "api") return problem(404, "not_found");
    var self = this;

    if (seg[1] === "types" && m === "GET") {
      return json(200, Seed.TYPES.map(function (t) { return { type_id: t.type_id, id_prefix: t.id_prefix, context_view: t.context_view, scope_parents: t.scope_parents, fields: t.fields }; }));
    }

    if (seg[1] === "objects") {
      var type = seg[2], id = seg[3];
      if (!id) {
        if (m === "GET") {
          var list = this.reachable(actor, type).map(function (e) { return self.serialize(actor, e); });
          Object.keys(q).forEach(function (k) {
            if (k === "limit") return;
            list = list.filter(function (e) { return String(e.data[k] == null ? "" : e.data[k]).toLowerCase() === String(q[k]).toLowerCase(); });
          });
          return json(200, list.slice(0, parseInt(q.limit || "200", 10)));
        }
        if (m === "POST") return this.createEntity(actor, type, body);
        return problem(405, "method_not_allowed");
      }
      var e = this.state.entities[id];
      if (!e || e.type !== type || this.effectiveRank(actor, id) < FLOORS.View) return problem(404, "not_found");
      if (m === "OPTIONS") return this.describe(actor, e);
      if (m === "GET" || m === "HEAD") return json(200, this.serialize(actor, e), { ETag: 'W/"' + e.version + '"' });
      if (m === "PUT" || m === "PATCH" || m === "DELETE") {
        var rank = this.effectiveRank(actor, id);
        if (m === "DELETE" && rank < FLOORS.Delete) return problem(403, "forbidden", "Delete needs admin+");
        if (m !== "DELETE" && rank < FLOORS.Edit) return problem(403, "forbidden", "Edit needs member+");
        var im = req.headers && (req.headers["if-match"] || req.headers["If-Match"]);
        if (!im) return problem(428, "precondition_required", "If-Match is required");
        if (im.replace(/\s/g, "") !== 'W/"' + e.version + '"') return problem(412, "precondition_failed", "stale ETag");
        if (m === "DELETE") {
          delete this.state.entities[id];
          this.event(id, actor, type + ".deleted", {});
          this.save();
          return json(204, null);
        }
        var bad = this.requireWrite(actor, e, body);
        if (bad) return problem(403, "field_forbidden", bad);
        if (body.status && e.type === "case") {
          var err = this.checkTransition(e, body.status);
          if (err) return problem(422, err, e.data.status + " → " + body.status);
        }
        var diff = {};
        Object.keys(body).forEach(function (k) { if (JSON.stringify(e.data[k]) !== JSON.stringify(body[k])) diff[k] = { old: e.data[k], new: body[k] }; });
        if (m === "PUT") { var nd = {}; Object.keys(body).forEach(function (k) { nd[k] = body[k]; }); e.data = nd; }
        else Object.keys(body).forEach(function (k) { e.data[k] = body[k]; });
        e.version++; e.updated_at = new Date().toISOString();
        this.event(id, actor, type + ".updated", { diff: diff });
        this.save();
        return json(200, this.serialize(actor, e), { ETag: 'W/"' + e.version + '"' });
      }
      return problem(405, "method_not_allowed");
    }

    if (seg[1] === "search" && m === "GET") {
      var qq = String(q.q || "").toLowerCase();
      if (!qq) return json(200, []);
      var hits = [];
      this.reachable(actor, q.type || null).forEach(function (e) {
        var t = self.typeById[e.type];
        if (!t) return;
        t.fields.forEach(function (f) {
          if (!f.searchable) return;
          var v = String(e.data[f.field] == null ? "" : e.data[f.field]).toLowerCase();
          var ix = v.indexOf(qq);
          if (ix !== -1) hits.push({ entity_id: e.id, type: e.type, snippet: String(e.data[f.field]), rank: 1 / (1 + ix) });
        });
      });
      hits.sort(function (a, b) { return b.rank - a.rank; });
      return json(200, hits.slice(0, 20));
    }

    if (seg[1] === "conversations" && seg[3] === "feed" && m === "GET") {
      var key = seg[2];
      if (this.state.entities[key] && this.effectiveRank(actor, key) < FLOORS.View) return problem(404, "not_found");
      return json(200, this.feedOf(key));
    }

    if (seg[1] === "files" && !seg[2] && m === "POST") {
      return this.uploadCsv(actor, body.project_id, body.filename || "upload.csv", body.csv || "", body.file_type);
    }
    if (seg[1] === "files" && seg[2] && seg[3] === "steps" && m === "POST") {
      return this.addStep(actor, seg[2], body.kind, body.params || {});
    }
    if (seg[1] === "files" && seg[2] && seg[3] === "rows" && m === "GET") {
      var tb = this.getTable(seg[2]);
      if (!tb || this.effectiveRank(actor, seg[2]) < FLOORS.View) return problem(404, "not_found");
      var off = parseInt(q.offset || "0", 10), lim = Math.min(parseInt(q.limit || "50", 10), 500);
      return json(200, { headers: tb.headers, rows: tb.rows.slice(off, off + lim), total: tb.rows.length });
    }

    if (seg[1] === "manifest" && m === "GET") {
      var ws = q.workspace;
      var types = Seed.TYPES.map(function (t) {
        return { type_id: t.type_id, fields: t.fields.map(function (f) { return { field: f.field, kind: f.kind, enum: (f.options && f.options.enum) || null }; }) };
      });
      var files = this.reachable(actor, "file").filter(function (e) { return !ws || self.scopeChain(e.id).indexOf(ws) !== -1; })
        .map(function (e) { return { id: e.id, name: e.data.filename, file_type: e.data.file_type, columns: (e.data.columns_meta || []).map(function (c) { return c.name; }) }; });
      return json(200, { workflows: Seed.WORKFLOWS, types: types, files: files });
    }
    if (seg[1] === "manifest" && false) { /* reserved */ }

    if (seg[1] === "values" && m === "GET") {                 // column-distinct, lazy per field
      var tb2 = this.getTable(q.file);
      if (!tb2) return json(200, []);
      var ci = tb2.headers.findIndex(function (h) { return h.toLowerCase() === String(q.col || "").toLowerCase(); });
      if (ci === -1) return json(200, []);
      var seen = {}, vals = [];
      for (var i = 0; i < tb2.rows.length && vals.length < 8; i++) {
        var v = String(tb2.rows[i][ci]).trim();
        if (v.length && !seen[v] && !Csv.isSentinel(v)) { seen[v] = 1; vals.push(v); }
      }
      return json(200, vals);
    }

    return problem(404, "not_found");
  };

  return { Engine: Engine, FLOORS: FLOORS };
});

/* numu-sim · numu-nacl.js — nacl command → plan → REAL execution over the engine.
   Grammar per uploads/nacl-commands.js: verb:target.attribute[op]value, chained
   clauses, ' " ` quoting, projections, on: loops, pipeline words (unwrap · clean ·
   repair · rename dots · sort · group …). Returns console feed blocks + client
   effects; every data op actually runs against the engine's registry + tables. */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  root.NumuNacl = mod;
})(typeof window !== "undefined" ? window : globalThis, function () {

  var CsvLib = null;
  function csvlib() {
    if (CsvLib) return CsvLib;
    CsvLib = (typeof module !== "undefined" && typeof require === "function") ? require("./numu-csv.js") : (typeof window !== "undefined" ? window.NumuCsv : globalThis.NumuCsv);
    return CsvLib;
  }

  var SQL = { new: "INSERT", read: "SELECT", set: "UPDATE", del: "DELETE", on: "FOR EACH", post: "UPSERT", play: "PLAY", save: "MATERIALIZE" };
  var OPS = ["!=", ">=", "<=", "=", ">", "<"];

  function unquote(v) { v = (v || "").trim(); if (/^(['"`])[^]*\1$/.test(v)) return v.slice(1, -1); return v; }
  function clauses(text) {
    var out = [], re = /(\w+):((?:`[^`]*`|[\w.\-,])+)\s*(!=|>=|<=|=|>|<|\bcontains\b|\bstartswith\b|\bendswith\b)?\s*((?:"[^"]*"|'[^']*'|`[^`]*`|[^\s])*)?/g, m;
    while ((m = re.exec(text))) {
      if (!m[1]) continue;
      out.push({ action: m[1].toLowerCase(), target: m[2].replace(/`/g, ""), op: m[3] || (m[4] ? "=" : null), value: unquote(m[4] || "") });
    }
    return out;
  }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /* file profile → the console "data" block */
  function profileBlock(name, source, out) {
    return { type: "data", name: name + (String(name).endsWith(".csv") ? "" : ".csv"), source: source,
      rows: fmt(out.row_count), cols: String(out.col_count), nulls: String(out.fully_null_rows != null ? out.fully_null_rows : "—"),
      junk: (100 - Math.round(out.cleanness)) + "%", cleanness: out.cleanness,
      fileId: out.rid,
      columns: (out.columns || []).slice(0, 24).map(function (c) {
        return { name: c.name.length > 22 ? c.name.slice(0, 21) + "…" : c.name, full: c.name, dtype: c.semantic_dtype, nullPct: c.null_pct + "%" };
      }) };
  }
  function stepBlock(nacl, kind, impact) { return { type: "step", nacl: nacl, kind: kind, impact: impact }; }

  /* resolve which file "it" is: explicit name → registry; else ctx.itFileId */
  function resolveFile(engine, ctx, name) {
    var files = engine.reachable(ctx.actor, "file");
    if (name) {
      var n = String(name).replace(/\.csv$/i, "").toLowerCase();
      var hit = files.find(function (e) { return String(e.data.filename).toLowerCase() === n; });
      return hit ? hit.id : null;
    }
    return ctx.itFileId || (files.length ? files[files.length - 1].id : null);
  }

  function exec(engine, ctx, text) {
    var t = text.trim(), blocks = [], effects = [], A = ctx.actor;
    var cs = clauses(t);
    var lower = t.toLowerCase();

    /* — pipeline words (no colon): unwrap · repair · clean · rename dots|snake · dedupe · sort · group — */
    var pipeM = /^(unwrap|repair|clean|dedupe|rename\s+(dots|snake)|sort\s+(?:by\s+)?(\S+)(\s+desc|\s+asc)?|group\s+(\w+)\s+by\s+(\S+)|drop\s+nulls\s*(\S+)?)/i.exec(t);
    if (!cs.length && pipeM) {
      var fid = resolveFile(engine, ctx, null);
      if (!fid) return { blocks: [stepBlock(t, "warn", "no csv in this thread — read:file.name=… or save an attachment first")], effects: effects };
      var e = engine.state.entities[fid], fname = e.data.filename;
      var r;
      if (/^unwrap/i.test(t)) r = engine.addStep(A, fid, "unwrap", {});
      else if (/^repair/i.test(t)) r = engine.addStep(A, fid, "repair", {});
      else if (/^clean/i.test(t)) r = engine.addStep(A, fid, "clean", {});
      else if (/^dedupe/i.test(t)) r = engine.addStep(A, fid, "dedupe", {});
      else if (/^rename/i.test(t)) r = engine.addStep(A, fid, "rename", { mode: pipeM[2].toLowerCase() });
      else if (/^drop\s+nulls/i.test(t)) r = engine.addStep(A, fid, "drop", { nulls: true, col: pipeM[7] });
      else if (/^sort/i.test(t)) r = engine.addStep(A, fid, "sort", { col: pipeM[3], desc: !/asc/i.test(pipeM[4] || "desc") });
      else if (/^group/i.test(t)) {
        var tbl = engine.getTable(fid);
        var g = csvlib().groupBy(tbl, pipeM[6], pipeM[5].toLowerCase() === "count" ? "count" : pipeM[5].toLowerCase(), null, 8);
        blocks.push(stepBlock(t, "read", "GROUP " + pipeM[5] + " BY " + pipeM[6] + " · " + g.length + " buckets · " + fmt(tbl.rows.length) + " rows scanned"));
        blocks.push({ type: "dashboard", name: "group · " + pipeM[6], charts: [{ nacl: t, type: "bar", cats: g }] });
        return { blocks: blocks, effects: effects };
      }
      if (r && r.status === 200) {
        blocks.push(stepBlock(t, "set", r.kind + " applied · " + fmt(r.body.row_count) + " rows × " + r.body.col_count + " cols · cleanness " + r.body.cleanness + "%"));
        blocks.push(profileBlock(fname, "step " + r.body.kind + " · derived, blob untouched", { rid: fid, row_count: r.body.row_count, col_count: r.body.col_count, cleanness: r.body.cleanness, fully_null_rows: 0, columns: r.body.columns }));
      } else if (r) blocks.push(stepBlock(t, "warn", r.body && r.body.detail || "step failed"));
      return { blocks: blocks, effects: effects };
    }

    if (!cs.length) return { blocks: [{ type: "sent", channel: ctx.channel || "chat", text: t }], effects: effects };

    var c = cs[0], chain = cs.slice(1);
    var parts = c.target.split(".");
    var entity = parts[0].toLowerCase(), attr = parts.slice(1).join(".");

    /* — client-side app commands — */
    if (c.action === "set" && entity === "theme") {
      effects.push({ kind: "theme", attr: attr || "mode", value: c.value });
      blocks.push(stepBlock(t, "set", "UPDATE theme." + (attr || "mode") + "='" + c.value + "' · applied, no settings page"));
      return { blocks: blocks, effects: effects };
    }
    if (entity === "panel" && (c.action === "del" || c.action === "set")) {
      effects.push({ kind: "closePanel" });
      return { blocks: [stepBlock(t, c.action, "context panel closed")], effects: effects };
    }
    if (c.action === "play") {
      effects.push({ kind: "play", query: c.value, volume: (chain.find(function (k) { return k.target.indexOf("volume") === 0; }) || {}).value });
      return { blocks: [stepBlock(t, "play", (c.value || "current track") + " → player")], effects: effects };
    }

    /* — read:file.… — */
    if (c.action === "read" && entity === "file") {
      if (attr === "type") {
        var fam = /mp3|wav|audio/i.test(c.value) ? "audio" : /mp4|mov|video/i.test(c.value) ? "video" : /jpg|png|image/i.test(c.value) ? "image" : c.value;
        var hits = engine.reachable(A, "file").filter(function (e) { return e.data.file_type === fam; });
        blocks.push(stepBlock(t, "read", "SELECT * FROM file WHERE type='" + c.value + "' · " + hits.length + " rows · reach-filtered"));
        hits.forEach(function (o) {
          var at = o.data.attributes || {};
          blocks.push({ type: "object", objType: fam, objIcon: at.icon || (fam === "audio" ? "music-note-beamed" : fam === "video" ? "camera-video-fill" : "images"),
            accentColor: at.accent || "var(--chart-3)", title: o.data.filename, meta: at.meta || fam, objRef: at.consoleRef || o.id });
        });
        return { blocks: blocks, effects: effects };
      }
      var fid2 = resolveFile(engine, ctx, c.value || attr === "name" ? c.value : null);
      if (!fid2) { blocks.push(stepBlock(t, "warn", "0 rows · no file named '" + c.value + "' in reach")); return { blocks: blocks, effects: effects }; }
      var fe = engine.state.entities[fid2];
      var tbl2 = engine.getTable(fid2);
      if (!tbl2) { effects.push({ kind: "needBlob", id: fid2 }); blocks.push(stepBlock(t, "read", "file found · fetching original bytes…")); return { blocks: blocks, effects: effects }; }
      blocks.push(stepBlock(t, "read", "SELECT * FROM file WHERE " + (attr || "name") + "='" + (c.value || fe.data.filename) + "' · " + fmt(tbl2.rows.length) + " rows on device"));
      blocks.push(profileBlock(fe.data.filename, "GlueSQL · on device · cleanness " + fe.data.cleanness + "%", { rid: fid2, row_count: tbl2.rows.length, col_count: tbl2.headers.length, cleanness: fe.data.cleanness, fully_null_rows: 0, columns: fe.data.columns_meta }));
      effects.push({ kind: "it", id: fid2 });
      chain.forEach(function (k) { var sub = exec(engine, Object.assign({}, ctx, { itFileId: fid2 }), k.action + ":" + k.target + (k.value ? k.op + k.value : "")); blocks = blocks.concat(sub.blocks); effects = effects.concat(sub.effects); });
      return { blocks: blocks, effects: effects };
    }

    /* — registry objects: read/new/set/del on case · booking · project · user · … — */
    var REG = { case: "case", booking: "booking", session: "booking", project: "project", user: "user", txn: "transaction", transaction: "transaction", connector: "connector", milestone: "milestone" };
    if (REG[entity] && (c.action === "read" || c.action === "new" || c.action === "set" || c.action === "del" || c.action === "transition")) {
      var type = REG[entity];
      if (c.action === "read") {
        var rq = {}; if (attr && c.value && attr !== "id" && attr !== "code") rq[attr] = c.value;
        var res = engine.handle({ method: "GET", path: "/api/objects/" + type, query: rq, actor: A });
        var rows = res.body || [];
        if (attr === "id" || attr === "code") rows = rows.filter(function (e) { return e.id.toLowerCase().indexOf(String(c.value).toLowerCase()) !== -1 || String((e.data.attributes || {}).code || "").toLowerCase() === String(c.value).toLowerCase(); });
        blocks.push(stepBlock(t, "read", "SELECT * FROM " + type + (attr ? " WHERE " + attr + "='" + c.value + "'" : "") + " · " + rows.length + " rows · RBAC-scoped"));
        rows.slice(0, 4).forEach(function (e) {
          blocks.push({ type: "object", objType: type === "booking" ? (e.data.kind === "hold" ? "hold" : "session") : type,
            objIcon: type === "booking" ? "record-circle" : type === "case" ? "kanban" : "collection",
            accentColor: "var(--chart-2)", title: e.data.name || e.data.title || e.id,
            meta: (e.data.status || "") + (e.data.starts_at ? " · " + e.data.starts_at.replace("T", " ") : "") + " · v" + e.version, objRef: e.id });
        });
        if (rows.length === 1 && chain.length) {
          var target = rows[0];
          chain.forEach(function (k) {
            if (k.action !== "set") return;
            var patch = {}; patch[k.target.split(".").pop()] = k.value;
            var up = engine.handle({ method: "PATCH", path: "/api/objects/" + type + "/" + target.id, body: patch, headers: { "if-match": 'W/"' + target.version + '"' }, actor: A });
            blocks.push(stepBlock(k.action + ":" + k.target + "=" + k.value, up.status === 200 ? "set" : "warn",
              up.status === 200 ? "UPDATE " + type + " SET " + k.target + "='" + k.value + "' WHERE id='" + target.id + "' · 1 row · v" + up.body.version + " · audited"
                : up.status + " " + (up.body.type || "") + " · " + (up.body.detail || "")));
            target.version = up.status === 200 ? up.body.version : target.version;
          });
        }
        return { blocks: blocks, effects: effects };
      }
      if (c.action === "new") {
        var body = {};
        chain.forEach(function (k) { body[k.target.split(".").pop()] = k.value; });
        if (attr && c.value) body[attr] = c.value;
        if (type === "case") { body.project_id = body.project_id || ctx.projectId; body.title = body.title || c.value || "untitled"; }
        if (type === "booking") { body.workspace_id = body.workspace_id || ctx.workspace; body.name = body.name || c.value || "session"; body.starts_at = body.starts_at || new Date().toISOString().slice(0, 16); }
        var cr = engine.handle({ method: "POST", path: "/api/objects/" + type, body: body, actor: A });
        blocks.push(stepBlock(t, cr.status === 201 ? "new" : "warn", cr.status === 201 ? "INSERT " + type + " · " + cr.body.id + " · owner edge granted · audited" : cr.status + " · " + (cr.body.detail || cr.body.type)));
        if (cr.status === 201) effects.push({ kind: "openObjectId", id: cr.body.id });
        return { blocks: blocks, effects: effects };
      }
    }

    /* — projections + row ops on "it" (the thread csv) — */
    var fid3 = resolveFile(engine, ctx, null);
    var Csv2 = csvlib();
    if (fid3) {
      var tbl3 = engine.getTable(fid3), fe3 = engine.state.entities[fid3];
      if (c.action === "read" && c.target.indexOf(",") !== -1) {
        var want = c.target.split(",");
        blocks.push(stepBlock(t, "read", "SELECT " + want.join(", ") + " FROM " + fe3.data.filename + " (it) · projection · " + fmt(tbl3.rows.length) + " rows"));
        return { blocks: blocks, effects: effects };
      }
      if (c.action === "on") {
        var matched = Csv2.applyStep(tbl3, { kind: "filter", params: { col: attr || parts[0], op: c.op || "=", value: c.value } }).rows.length;
        // on:city=London — attr may actually be the column when target has no dot
        var col = parts.length > 1 ? attr : parts[0];
        if (!chain.length) {
          blocks.push(stepBlock(t, "on", "loop scoped: " + col + "='" + c.value + "' · " + fmt(matched) + " rows match · chain a set/del to operate"));
          return { blocks: blocks, effects: effects };
        }
        chain.forEach(function (k) {
          if (k.action === "set") {
            var sc = k.target.split(".").pop();
            var r2 = engine.addStep(A, fid3, "update", { whereCol: col, whereValue: c.value, setCol: sc, setValue: k.value });
            blocks.push(stepBlock(t, "set", r2.status === 200 ? "for each " + col + "='" + c.value + "' → UPDATE SET " + sc + "='" + k.value + "' · " + fmt(r2.body.affected || matched) + " rows · step recorded, revertible" : "step failed"));
          } else if (k.action === "del") {
            var r3 = engine.addStep(A, fid3, "delete", { whereCol: col, whereValue: c.value });
            blocks.push(stepBlock(t, "del", "DELETE WHERE " + col + "='" + c.value + "' · " + fmt(r3.status === 200 ? r3.body.affected || matched : 0) + " rows · step recorded"));
          }
        });
        return { blocks: blocks, effects: effects };
      }
      if (c.action === "read" && attr && chain.length) {
        var matched2 = Csv2.applyStep(tbl3, { kind: "filter", params: { col: attr, op: "=", value: c.value } }).rows.length;
        blocks.push(stepBlock("read:" + c.target + "=" + c.value, "read", "SELECT * FROM " + fe3.data.filename + " WHERE " + attr + "='" + c.value + "' · " + fmt(matched2) + " row" + (matched2 === 1 ? "" : "s")));
        chain.forEach(function (k) {
          if (k.action !== "set") return;
          var sc2 = k.target.split(".").pop();
          var r4 = engine.addStep(A, fid3, "update", { whereCol: attr, whereValue: c.value, setCol: sc2, setValue: k.value });
          blocks.push(stepBlock(k.action + ":" + k.target + "=" + k.value, "set", "UPDATE SET " + sc2 + "='" + k.value + "' WHERE " + attr + "='" + c.value + "' · " + fmt(r4.status === 200 ? r4.body.affected : 0) + " rows · revertible"));
        });
        return { blocks: blocks, effects: effects };
      }
      if (c.action === "new" && (entity === "chart" || entity === "dashboard")) {
        var ctype = attr === "type" ? c.value : "bar";
        var byCol = tbl3.headers.find(function (h) { return /cause|type|city|region|plan|formule/i.test(h); }) || tbl3.headers[Math.min(6, tbl3.headers.length - 1)];
        var cats = Csv2.groupBy(tbl3, byCol, "count", null, ctype === "donut" || ctype === "pie" ? 6 : 8);
        var spec = { type: /donut|pie/i.test(ctype) ? "donut" : "bar", by: byCol, agg: "count" };
        var ch = engine.createEntity(A, entity === "chart" ? "chart" : "dashboard", entity === "chart"
          ? { project_id: ctx.projectId, file_id: fid3, title: "count by " + byCol, spec: spec }
          : { project_id: ctx.projectId, title: c.value || "dashboard", spec: { tiles: [{ spec: spec }] } }, {});
        blocks.push(stepBlock(t, "new", "CREATE " + entity + " · grouped " + fmt(tbl3.rows.length) + " rows → " + cats.length + " buckets · " + (ch.status === 201 ? ch.body.id : "")));
        blocks.push({ type: "dashboard", name: entity + " · count by " + byCol, charts: [{ nacl: t, type: spec.type, cats: cats }] });
        return { blocks: blocks, effects: effects };
      }
      if (c.action === "post" || c.action === "save") {
        blocks.push(stepBlock(t, c.action, (c.action === "post" ? "UPSERT " : "MATERIALIZE ") + (c.value || fe3.data.filename) + " · " + fmt(tbl3.rows.length) + " rows · keyed on id"));
        return { blocks: blocks, effects: effects };
      }
    }

    blocks.push(stepBlock(t, c.action, (SQL[c.action] || c.action.toUpperCase()) + " " + c.target + (c.value ? "='" + c.value + "'" : "") + " · no-op in sim (verb not wired)"));
    return { blocks: blocks, effects: effects };
  }

  return { exec: exec, clauses: clauses, profileBlock: profileBlock };
});

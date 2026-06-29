/* numu-nacl-engine.js — the nacl data engine, as a shared module.
   =============================================================================
   Pure transforms over a source `{ columns, rows, summary }`. No DOM, no `this`,
   no framework. Each op returns:
     { ok:true, nacl, step:{ kind, params }, impact, result:{ columns, rows, summary } }
   `parseOp(active, line)` routes a typed line to an op and returns that shape, or
   null when the line isn't a recognized data verb (so the caller can treat it as
   prose). Holds the parseOp/op* engine (ported from the retired `numu Data.dc.html`
   in P1) and the `{kind,params}` step contract documented in `nacl Reference.dc.html`.

   Scope (P1b): the cleaning core + filter — clean · cast · datetime · rename
   (+snake/dots) · fill · drop nulls/cols · keep · case · dedupe · <col op val>.
   P1c adds chart/pivot/group/sort/last/join + the bilingual skin (an injected ctx
   for kw/t/rLang) — today the nacl echo is plain English.
   ============================================================================= */
(function () {
  var SENT = ["???", "NA", "N/A", "null", "NULL", "-", "na", "n/a"];
  var SENTSET = new Set(SENT.map(function (s) { return s.toLowerCase(); }));

  function cn(c) { return c.name != null ? c.name : c.n; }
  function dt(c) { return c.dtype || c.k || "str"; }
  function isNull(v) { return v == null || v === "" || v === "NA" || v === "N/A"; }
  function isSent(v) { return v != null && v !== "" && SENTSET.has(String(v).toLowerCase()); }
  function colIdx(a, name) { return a.columns.findIndex(function (c) { return cn(c).toLowerCase() === String(name).toLowerCase(); }); }
  function isNum(c) { return dt(c) === "int" || dt(c) === "float"; }
  function fmt(n) { return Number(n).toLocaleString(); }

  // recompute per-column stats after a mutation so the card/panel stay honest
  function recompute(columns, rows) {
    var total = rows.length;
    return columns.map(function (c, i) {
      var nulls = 0, junk = 0, seen = Object.create(null), distinct = 0, sample = "";
      for (var r = 0; r < rows.length; r++) {
        var v = rows[r][i];
        if (isNull(v)) { nulls++; continue; }
        if (String(v) === "???") junk++;
        if (!seen[v]) { seen[v] = 1; distinct++; }
        if (!sample && String(v) !== "???") sample = String(v);
      }
      return Object.assign({}, c, {
        null_count: nulls, null_pct: total ? +(nulls / total * 100).toFixed(1) : 0,
        sentinel_count: junk, unique: distinct, sample: sample
      });
    });
  }
  function ok(active, columns, rows, step, nacl, impact) {
    return { ok: true, step: step, nacl: nacl, impact: impact,
      result: { columns: recompute(columns, rows), rows: rows, summary: active.summary } };
  }

  // ---- cleaning ops ----------------------------------------------------------
  function opClean(a, col) {
    var idxs = col ? [colIdx(a, col)] : a.columns.map(function (_, i) { return i; });
    var n = 0;
    var rows = a.rows.map(function (r) {
      var rr = r.slice();
      idxs.forEach(function (i) { if (i >= 0 && isSent(rr[i])) { rr[i] = null; n++; } });
      return rr;
    });
    return ok(a, a.columns, rows,
      { kind: "fix_invalid", params: col ? { sentinels: SENT, columns: [col] } : { sentinels: SENT } },
      "clean" + (col ? " " + col : ""), fmt(n) + " sentinels \u2192 null");
  }
  function opCast(a, col, type) {
    var i = colIdx(a, col); if (i < 0) return null;
    var columns = a.columns.map(function (c, k) { return k === i ? Object.assign({}, c, { dtype: type, k: type }) : c; });
    return ok(a, columns, a.rows, { kind: "cast", params: { column: col, dtype: type } },
      "cast " + col + " = " + type, col + " \u2192 " + type);
  }
  function opRename(a, from, to) {
    var i = colIdx(a, from); if (i < 0) return null;
    var columns = a.columns.map(function (c, k) { return k === i ? Object.assign({}, c, { name: to, n: to }) : c; });
    return ok(a, columns, a.rows, { kind: "rename_column", params: { from: from, to: to } },
      "rename " + from + " -> " + to, from + " \u2192 " + to);
  }
  function snakeName(s) { return String(s).trim().toLowerCase().replace(/[.\s]+/g, "_").replace(/[^\w]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""); }
  function opSnake(a) {
    var columns = a.columns.map(function (c) { var nn = snakeName(cn(c)); return Object.assign({}, c, { name: nn, n: nn }); });
    return ok(a, columns, a.rows, { kind: "snake_case_columns", params: {} },
      "rename snake", "every header \u2192 snake_case");
  }
  function opReplaceNames(a, find, repl) {
    var n = 0;
    var columns = a.columns.map(function (c) {
      var name = cn(c); if (name.indexOf(find) >= 0) n++;
      var nn = name.split(find).join(repl); return Object.assign({}, c, { name: nn, n: nn });
    });
    return ok(a, columns, a.rows, { kind: "replace_in_names", params: { find: find, replace: repl } },
      "rename dots", "\u201c" + find + "\u201d \u2192 \u201c" + repl + "\u201d in " + n + " headers");
  }
  function opFill(a, col, strat) {
    var i = colIdx(a, col); if (i < 0) return null;
    var mode = /^zero$/i.test(strat) ? "zero" : /^forward$/i.test(strat) ? "forward" : "fixed";
    var fixed = mode === "fixed" ? strat : (mode === "zero" ? 0 : null);
    var last = null, n = 0;
    var rows = a.rows.map(function (r) {
      var rr = r.slice();
      if (isNull(rr[i])) { rr[i] = mode === "forward" ? last : fixed; n++; }
      else last = rr[i];
      return rr;
    });
    return ok(a, a.columns, rows,
      { kind: "fill_nulls", params: { column: col, strategy: mode, value: mode === "fixed" ? String(fixed) : undefined } },
      "fill " + col + " = " + strat, fmt(n) + " nulls filled");
  }
  function opDropNulls(a, col) {
    var i = colIdx(a, col); if (i < 0) return null;
    var rows = a.rows.filter(function (r) { return !isNull(r[i]); });
    return ok(a, a.columns, rows, { kind: "drop_nulls", params: { column: col } },
      "drop nulls " + col, fmt(a.rows.length) + " \u2192 " + fmt(rows.length) + " rows");
  }
  function opDropColumns(a, names) {
    var keep = a.columns.map(function (c, i) { return i; }).filter(function (i) { return names.map(function (x) { return x.toLowerCase(); }).indexOf(cn(a.columns[i]).toLowerCase()) < 0; });
    var columns = keep.map(function (i) { return a.columns[i]; });
    var rows = a.rows.map(function (r) { return keep.map(function (i) { return r[i]; }); });
    return ok(a, columns, rows, { kind: "drop_columns", params: { cols: names } },
      "drop " + names.join(", "), "dropped " + names.length + " column" + (names.length > 1 ? "s" : ""));
  }
  function opKeep(a, names) {
    var order = names.map(function (x) { return colIdx(a, x); }).filter(function (i) { return i >= 0; });
    var columns = order.map(function (i) { return a.columns[i]; });
    var rows = a.rows.map(function (r) { return order.map(function (i) { return r[i]; }); });
    return ok(a, columns, rows, { kind: "filter_columns", params: { cols: names } },
      "keep " + names.join(", "), "kept " + columns.length + " of " + a.columns.length + " columns");
  }
  function opChangeCase(a, mode) {
    var n = 0;
    var rows = a.rows.map(function (r) {
      return r.map(function (v, i) {
        if (!isNum(a.columns[i]) && typeof v === "string" && v) { var nv = mode === "upper" ? v.toUpperCase() : v.toLowerCase(); if (nv !== v) n++; return nv; }
        return v;
      });
    });
    return ok(a, a.columns, rows, { kind: "change_case", params: { mode: mode } },
      "case " + mode, fmt(n) + " values " + mode + "cased");
  }
  function opDedupe(a, full) {
    var seen = Object.create(null), rows = [];
    a.rows.forEach(function (r) {
      if (full && r.every(function (v) { return isNull(v); })) return;
      var key = JSON.stringify(r); if (!seen[key]) { seen[key] = 1; rows.push(r); }
    });
    return ok(a, a.columns, rows, { kind: "dedupe", params: full ? { full: true } : {} },
      "dedupe" + (full ? " full" : ""), fmt(a.rows.length) + " \u2192 " + fmt(rows.length) + " rows");
  }

  // ---- filter ----------------------------------------------------------------
  function parsePred(a, t) {
    var cols = a.columns.map(function (c) { return cn(c).toLowerCase(); });
    var s = t.replace(/^\s*(filter|where|only|keep)\s+/i, "").trim();
    var m = /([\w.]+)\s*(>=|<=|!=|=|>|<|\bis\b|\bcontains\b)\s*"?([^"]+?)"?\s*$/i.exec(s);
    if (m && cols.indexOf(m[1].toLowerCase()) >= 0) {
      var op = m[2].toLowerCase(); if (op === "is") op = "="; 
      return { col: m[1].toLowerCase(), op: op, val: m[3].trim() };
    }
    return null;
  }
  function opFilter(a, pred) {
    var i = colIdx(a, pred.col); var c = a.columns[i]; var n = isNum(c);
    function test(cell) {
      if (isNull(cell)) return false;
      if (pred.op === "contains") return String(cell).toLowerCase().indexOf(pred.val.toLowerCase()) >= 0;
      if (n) { var x = +cell, y = +pred.val; return pred.op === ">" ? x > y : pred.op === "<" ? x < y : pred.op === ">=" ? x >= y : pred.op === "<=" ? x <= y : pred.op === "!=" ? x !== y : x === y; }
      var p = String(cell).toLowerCase(), q = pred.val.toLowerCase(); return pred.op === "!=" ? p !== q : p === q;
    }
    var rows = a.rows.filter(function (r) { return test(r[i]); });
    return ok(a, a.columns, rows, { kind: "filter", params: { column: pred.col, op: pred.op, value: pred.val } },
      pred.col + " " + pred.op + " " + pred.val,
      fmt(a.rows.length) + " \u2192 " + fmt(rows.length) + " rows \u00b7 " + fmt(a.rows.length - rows.length) + " filtered out");
  }

  // ---- query (read-only: group / sort / chart) -------------------------------
  function aggregate(a, dim, measure) {
    var di = colIdx(a, dim); if (di < 0) return null;
    var isCount = String(measure).toLowerCase() === "count";
    var mi = isCount ? -1 : colIdx(a, measure);
    var map = Object.create(null), order = [];
    a.rows.forEach(function (r) {
      var key = isNull(r[di]) ? "\u2014" : String(r[di]);
      if (!(key in map)) { map[key] = 0; order.push(key); }
      map[key] += isCount ? 1 : (+r[mi] || 0);
    });
    var cats = order.map(function (k) { return { label: k, value: map[k] }; });
    cats.sort(function (x, y) { return y.value - x.value; });
    return cats;
  }
  function opGroup(a, dim, measure) {
    var cats = aggregate(a, dim, measure); if (!cats) return null;
    var label = String(measure).toLowerCase() === "count" ? "count" : measure;
    return { ok: true, query: true, nacl: "group " + measure + " by " + dim, impact: cats.length + " groups",
      view: { columns: [{ name: dim, dtype: "str" }, { name: label, dtype: "int" }], rows: cats.map(function (c) { return [c.label, c.value]; }) } };
  }
  function opSort(a, col, dir) {
    var i = colIdx(a, col); if (i < 0) return null;
    var rows = a.rows.slice().sort(function (x, y) {
      var p = x[i], q = y[i]; if (isNull(p)) return 1; if (isNull(q)) return -1;
      var pn = +p, qn = +q; var cmp = (!isNaN(pn) && !isNaN(qn)) ? (pn - qn) : (p < q ? -1 : p > q ? 1 : 0);
      return cmp * (dir === "desc" ? -1 : 1);
    });
    return { ok: true, query: true, nacl: "sort " + col + " " + dir, impact: "sorted by " + col + " " + dir, view: { columns: a.columns, rows: rows } };
  }
  function opChart(a, t) {
    var m = /^chart\s+(\w+)\s+(\w+)\s+by\s+([\w.]+)/i.exec(t); if (!m) return null;
    var type = m[1].toLowerCase(), measure = m[2], dim = m[3];
    var cats = aggregate(a, dim, measure); if (!cats) return null;
    var max = cats.reduce(function (mx, c) { return Math.max(mx, c.value); }, 0) || 1;
    var bars = cats.slice(0, 12).map(function (c) { return { label: c.label, value: fmt(c.value), pct: Math.max(2, Math.round(c.value / max * 100)) + "%" }; });
    return { ok: true, chart: true, nacl: "chart " + type + " " + measure + " by " + dim, title: measure + " by " + dim, type: type, impact: cats.length + " categories", bars: bars, cats: cats.slice(0, 12) };
  }

  function opLast(a, n, byCol) {
    var col = byCol && colIdx(a, byCol) >= 0 ? byCol : (function () { var c = a.columns.find(function (c) { return /date|heure|time|ts/i.test(cn(c)); }); return c ? cn(c) : cn(a.columns[0]); })();
    var i = colIdx(a, col);
    var rows = a.rows.filter(function (r) { return !isNull(r[i]); }).slice().sort(function (x, y) { return x[i] < y[i] ? 1 : x[i] > y[i] ? -1 : 0; }).slice(0, n);
    return { ok: true, query: true, nacl: "last " + n + " by " + col, impact: "last " + n + " of " + fmt(a.rows.length), view: { columns: a.columns, rows: rows } };
  }
  function opPivot(a, measure, rowDim, colDim) {
    var ri = colIdx(a, rowDim), ci = colIdx(a, colDim); if (ri < 0 || ci < 0) return null;
    var isCount = String(measure).toLowerCase() === "count", mi = isCount ? -1 : colIdx(a, measure);
    var rowKeys = [], colKeys = [], cell = Object.create(null);
    a.rows.forEach(function (r) {
      var rk = isNull(r[ri]) ? "\u2014" : String(r[ri]), ck = isNull(r[ci]) ? "\u2014" : String(r[ci]);
      if (rowKeys.indexOf(rk) < 0) rowKeys.push(rk); if (colKeys.indexOf(ck) < 0) colKeys.push(ck);
      var key = rk + "\u0001" + ck; cell[key] = (cell[key] || 0) + (isCount ? 1 : (+r[mi] || 0));
    });
    colKeys = colKeys.slice(0, 8);
    var columns = [{ name: rowDim, dtype: "str" }].concat(colKeys.map(function (c) { return { name: c, dtype: "int" }; }));
    var rows = rowKeys.slice(0, 30).map(function (rk) { return [rk].concat(colKeys.map(function (ck) { return cell[rk + "\u0001" + ck] || 0; })); });
    return { ok: true, query: true, nacl: "pivot " + measure + " by " + rowDim + " over " + colDim, impact: rowKeys.length + "\u00d7" + colKeys.length, view: { columns: columns, rows: rows } };
  }

  // ---- router ----------------------------------------------------------------
  function parseOp(a, line) {
    var t = String(line || "").trim(); if (!t || !a || !a.columns) return null;
    var lc = t.toLowerCase();
    var cols = a.columns.map(function (c) { return cn(c).toLowerCase(); });
    function firstCol(s) { var toks = s.split(/\s+/); for (var k = 0; k < toks.length; k++) { if (cols.indexOf(toks[k].toLowerCase()) >= 0) return toks[k]; } return null; }
    var m;
    if (/^clean\b/.test(lc)) return opClean(a, firstCol(t.replace(/^\S+\s*/, "")));
    if (/^cast\b/.test(lc)) { m = /^cast\s+([\w.]+)\s*(?:=|to)\s*(\w+)/i.exec(t); return m ? opCast(a, m[1], m[2].toLowerCase()) : null; }
    if (/^datetime\b/.test(lc)) { var dc = firstCol(t.replace(/^\S+\s*/, "")); return dc ? opCast(a, dc, "datetime") : null; }
    if (/^rename\b/.test(lc)) {
      if (/\bsnake\b/.test(lc)) return opSnake(a);
      if (/\bdots?\b/.test(lc)) return opReplaceNames(a, ".", "_");
      m = /^rename\s+([\w.]+)\s*(?:->|to|\u2192)\s*([\w.]+)/i.exec(t); return m ? opRename(a, m[1], m[2]) : null;
    }
    if (/^snake\b/.test(lc)) return opSnake(a);
    if (/^fill\b/.test(lc)) { m = /^fill\s+([\w.]+)\s*(?:=\s*)?(zero|forward|.+)?$/i.exec(t); return m ? opFill(a, m[1], (m[2] || "zero").trim()) : null; }
    if (/^drop\b/.test(lc)) {
      if (/\bnulls?\b/.test(lc)) { var nc = firstCol(t.replace(/\b(nulls?|drop)\b/ig, "")); if (nc) return opDropNulls(a, nc); }
      var ds = t.replace(/^\S+\s*/, "").split(/[,\s]+/).filter(function (w) { return cols.indexOf(w.toLowerCase()) >= 0; });
      return ds.length ? opDropColumns(a, ds) : null;
    }
    if (/^keep\b/.test(lc)) { var ks = t.replace(/^\S+\s*/, "").split(/[,\s]+/).filter(function (w) { return cols.indexOf(w.toLowerCase()) >= 0; }); return ks.length ? opKeep(a, ks) : null; }
    if (/^case\b/.test(lc)) return opChangeCase(a, /upper/.test(lc) ? "upper" : "lower");
    if (/^dedupe\b/.test(lc)) return opDedupe(a, /\bfull\b/.test(lc));
    if (/^chart\b/.test(lc)) return opChart(a, t);
    m = /^group\s+(\w+)\s+by\s+([\w.]+)/i.exec(t); if (m && cols.indexOf(m[2].toLowerCase()) >= 0) return opGroup(a, m[2], m[1]);
    m = /^sort\s+(?:by\s+)?([\w.]+)(\s+desc|\s+asc)?/i.exec(t); if (m && cols.indexOf(m[1].toLowerCase()) >= 0) return opSort(a, m[1], /asc/i.test(m[2] || "") ? "asc" : "desc");
    m = /^last\s+(\d+)(?:\s+by\s+([\w.]+))?/i.exec(t); if (m) return opLast(a, +m[1], m[2]);
    m = /^pivot\s+(\w+)\s+by\s+([\w.]+)\s+over\s+([\w.]+)/i.exec(t); if (m) return opPivot(a, m[1], m[2], m[3]);
    var pred = parsePred(a, t); if (pred) return opFilter(a, pred);
    return null;
  }

  window.NUMU_NACL = { parseOp: parseOp, recompute: recompute, cn: cn };
})();

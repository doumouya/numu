/* numu-sim · numu-csv.js — the 0017 ingest pipeline in plain JS (browser + Node).
   Faithful to uploads/numu-csv-flow-and-datatypes.md: encoding note, delimiter
   sniff, wrapped-single-column rule, 6-value dtype/semantic vocabulary (FR-first
   sniff, sentinels, vetoes), ColumnMeta, cleanness = value_quality × structural,
   and the step pipeline (derive-don't-store: replay(blob, steps)).            */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  root.NumuCsv = mod;
})(typeof window !== "undefined" ? window : globalThis, function () {

  var SENTINELS = {};
  ["", "n/a", "na", "n.a.", "-", "--", "—", "–", "?", "??", "???", "null", "(null)", "<null>", "none",
   "nan", "nil", ".", "..", "tbd", "tba", "x", "unknown", "undefined", "missing", "(blank)", "blank",
   "inconnu", "n/d", "nd", "n.d.", "non disponible", "non communiqué", "s/o", "s.o.", "n.c.", "sans objet",
   "#n/a", "#name?", "#ref!", "#value!", "#div/0!", "#num!", "#null!"].forEach(function (s) { SENTINELS[s] = 1; });
  function isSentinel(v) { return v == null || SENTINELS[String(v).trim().toLowerCase()] === 1; }

  var BOOL_WORDS = { "true": 1, "false": 1, "yes": 1, "no": 1, "y": 1, "n": 1, "t": 1, "f": 1, "oui": 1, "non": 1, "vrai": 1, "faux": 1, "o": 1, "0": 1, "1": 1 };
  var BOOL_NONNUM = { "true": 1, "false": 1, "yes": 1, "no": 1, "y": 1, "n": 1, "t": 1, "f": 1, "oui": 1, "non": 1, "vrai": 1, "faux": 1 };
  var ID_TOKENS = ["postcode", "postal", "zip", "zipcode", "siren", "siret", "tva", "phone", "telephone", "mobile", "fax", "iban", "bic", "swift", "id", "uid", "guid", "uuid", "ssn", "code", "ref"];

  function stripBOM(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
  function normalizeEOL(s) { return s.replace(/\r\n?/g, "\n"); }

  /* — one CSV line → cells (quote-aware, "" escaping) — */
  function parseLine(line, d) {
    var out = [], cur = "", q = false, i = 0;
    while (i < line.length) {
      var ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
        cur += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === d) { out.push(cur); cur = ""; i++; continue; }
      cur += ch; i++;
    }
    out.push(cur);
    return out;
  }
  function countCells(line, d) { return parseLine(line, d).length; }

  /* — delimiter / wrapped-file sniff over the first ~15 lines — */
  function sniff(text) {
    var lines = text.split("\n").filter(function (l) { return l.length; }).slice(0, 15);
    if (!lines.length) return { delim: ",", wrapped: false };
    var fullyQuoted = lines.every(function (l) { return /^".*"$/.test(l.trim()); });
    var best = ",", bestScore = -1;
    [",", ";", "\t", "|"].forEach(function (d) {
      var counts = lines.map(function (l) { return countCells(l, d); });
      var head = counts[0];
      if (head < 2) return;
      var agree = counts.filter(function (c) { return c === head; }).length / counts.length;
      var score = agree * head;
      if (agree >= 0.8 && score > bestScore) { bestScore = score; best = d; }
    });
    // wrapped single-column: every line one quoted blob AND no delimiter parses >1 col consistently
    var wrapped = fullyQuoted && bestScore < 0;
    return { delim: best, wrapped: wrapped };
  }

  /* — parse: text → { headers, rows } (TEXT cells; ingest is TOTAL, never rejects) — */
  function parse(text, opts) {
    opts = opts || {};
    text = normalizeEOL(stripBOM(text));
    var s = sniff(text);
    var lines = text.split("\n");
    while (lines.length && !lines[lines.length - 1].length) lines.pop();
    var headers, rows = [];
    if (s.wrapped) {
      // parse line-literally: strip outer quotes, un-double inner quotes → ONE column
      var unwrapCell = function (l) { l = l.trim(); if (/^".*"$/.test(l)) l = l.slice(1, -1); return l.replace(/""/g, '"'); };
      headers = [unwrapCell(lines[0] || "column")];
      for (var i = 1; i < lines.length; i++) { if (!lines[i].length) continue; rows.push([unwrapCell(lines[i])]); }
    } else {
      headers = parseLine(lines[0] || "", s.delim).map(function (h) { return h.trim(); });
      var w = headers.length;
      for (var j = 1; j < lines.length; j++) {
        if (!lines[j].length) continue;
        var cells = parseLine(lines[j], s.delim);
        if (cells.length > w) cells = cells.slice(0, w);            // truncate_ragged_lines
        while (cells.length < w) cells.push("");                    // pad short
        rows.push(cells);
      }
    }
    if (opts.maxRows && rows.length > opts.maxRows) rows = rows.slice(0, opts.maxRows);
    return { headers: headers, rows: rows, delim: s.delim, wrapped: s.wrapped, encoding: /\uFFFD/.test(text) ? "windows-1252 (mojibake)" : "utf-8" };
  }

  /* — dtype (storage): what strict parsing proves · int float bool date string empty — */
  function looksInt(v) { return /^[+-]?\d+$/.test(v); }
  function looksFloat(v) { return /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(v) && /\./.test(v); }
  function looksISODate(v) { return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(v); }
  function storageDtype(values) {
    var seen = 0, ints = 0, floats = 0, dates = 0, bools = 0;
    for (var i = 0; i < values.length; i++) {
      var v = String(values[i] == null ? "" : values[i]).trim();
      if (!v.length) continue;
      seen++;
      if (looksInt(v)) ints++;
      else if (looksFloat(v)) floats++;
      if (looksISODate(v)) dates++;
      if (v === "true" || v === "false") bools++;
    }
    if (!seen) return "empty";
    if (bools === seen) return "bool";
    if (dates === seen) return "date";
    if (ints === seen) return "int";
    if (ints + floats === seen) return "float";
    return "string";
  }

  /* — semantic sniff (FR-first) · ≤50 non-null non-sentinel samples, ≥80% agreement — */
  function looksDateShaped(v) {
    if (/^\d{8}$/.test(v)) return true;
    var m = v.split(/[\/\-.]/);
    return m.length === 3 && m.every(function (g) { return /^\d{1,4}$/.test(g) && g.length <= 4; });
  }
  function looksNumericIsh(v) {
    if (!v.length) return false;
    var c0 = v[0];
    if (!/[\d+\-.€$£]/.test(c0)) return false;
    var digits = (v.match(/\d/g) || []).length;
    return digits / v.length >= 0.5;
  }
  function semanticDtype(name, values, storage) {
    if (storage !== "string") return storage;
    var samples = [];
    for (var i = 0; i < values.length && samples.length < 50; i++) {
      var v = String(values[i] == null ? "" : values[i]).trim();
      if (!v.length || isSentinel(v)) continue;
      samples.push(v.toLowerCase());
    }
    if (!samples.length) return "string";
    var n = samples.length, TH = 0.8;
    var boolHits = 0, boolNonNum = 0, dateHits = 0, numHits = 0, leadZero = false;
    samples.forEach(function (v) {
      if (BOOL_WORDS[v]) { boolHits++; if (BOOL_NONNUM[v]) boolNonNum++; }
      if (looksDateShaped(v)) dateHits++;
      if (looksNumericIsh(v)) numHits++;
      if (/^0\d+$/.test(v)) leadZero = true;
    });
    if (boolHits / n >= TH && boolNonNum > 0) return "bool";
    if (dateHits / n >= TH) return "date";
    var lname = name.toLowerCase();
    var idVeto = ID_TOKENS.some(function (t) { return lname.indexOf(t) !== -1; });
    if (numHits / n >= TH && !idVeto && !leadZero) return "float";
    return "string";
  }

  /* — summarize → ColumnMeta[] — */
  function summarize(headers, rows) {
    return headers.map(function (h, ci) {
      var col = rows.map(function (r) { return r[ci]; });
      var nonNull = [], nulls = 0, distinct = {}, distinctCount = 0, sample = null;
      for (var i = 0; i < col.length; i++) {
        var raw = col[i] == null ? "" : String(col[i]);
        var t = raw.trim();
        if (!t.length) { nulls++; continue; }
        nonNull.push(t);
        if (sample === null) sample = raw;
        if (distinct[t] === undefined && distinctCount <= 10000) { distinct[t] = 1; distinctCount++; }
      }
      var dtype = storageDtype(nonNull);
      var n = col.length || 1;
      return {
        name: h, dtype: dtype,
        semantic_dtype: semanticDtype(h, nonNull, dtype),
        null_pct: Math.round(1000 * nulls / n) / 10,
        unique_pct: Math.round(1000 * Math.min(distinctCount, n) / n) / 10,
        sample: sample
      };
    });
  }

  /* — cleanness = value_quality × structural_integrity (structural is a GATE) — */
  function strictParses(v, sem) {
    if (sem === "int") return looksInt(v);
    if (sem === "float") return looksNumericIsh(v) || looksFloat(v) || looksInt(v);
    if (sem === "bool") return BOOL_WORDS[v.toLowerCase()] === 1;
    if (sem === "date") return looksDateShaped(v) || looksISODate(v);
    return true;
  }
  function cleanness(headers, rows, meta) {
    var cells = 0, blanks = 0, typeOk = 0, typed = 0, hygiene = 0, fullyNullRows = 0;
    var capRows = Math.min(rows.length, 20000);
    var rowKeys = {}, dup = 0;
    for (var i = 0; i < rows.length; i++) {
      var allNull = true;
      for (var c = 0; c < headers.length; c++) {
        var raw = rows[i][c] == null ? "" : String(rows[i][c]);
        var t = raw.trim();
        cells++;
        if (!t.length) { blanks++; continue; }
        allNull = false;
        if (!isSentinel(t) && raw === t) hygiene++;
        var sem = meta[c].semantic_dtype;
        if (sem !== "string" && sem !== "empty") { typed++; if (strictParses(t, sem)) typeOk++; }
      }
      if (allNull) fullyNullRows++;
      if (i < capRows) { var k = rows[i].join("\u0001"); if (rowKeys[k]) dup++; else rowKeys[k] = 1; }
    }
    var nonBlank = Math.max(1, cells - blanks);
    var completeness = cells ? 1 - blanks / cells : 1;
    var typeConsistency = typed ? typeOk / typed : 1;
    var valueHygiene = nonBlank ? hygiene / nonBlank : 1;
    var rowUniq = capRows ? 1 - dup / capRows : 1;
    var vq = 0.35 * completeness + 0.25 * typeConsistency + 0.25 * valueHygiene + 0.15 * rowUniq;
    var shape = headers.length > 1 ? 1 : 0.35;                                   // under-parsed wrapped file
    var repl = 0; rows.slice(0, 2000).forEach(function (r) { r.forEach(function (v) { if (/\uFFFD/.test(String(v))) repl++; }); });
    var encoding = repl ? Math.max(0.5, 1 - repl / 2000) : 1;
    var header = headers.every(function (h) { return h && h.trim().length; }) ? 1 : 0.5;
    var si = Math.min(shape, encoding, header);
    return { score: Math.round(1000 * vq * si) / 10, fully_null_rows: fullyNullRows,
             detail: { completeness: completeness, type_consistency: typeConsistency, value_hygiene: valueHygiene, row_uniqueness: rowUniq, shape: shape, encoding: encoding, header: header } };
  }

  /* — steps · derive-don't-store: replay(blobText, steps) → frame — */
  function applyStep(tbl, step) {
    var H = tbl.headers, R = tbl.rows, p = step.params || {};
    var ix = function (name) { return H.findIndex(function (h) { return h.toLowerCase() === String(name || "").toLowerCase(); }); };
    switch (step.kind) {
      case "original": return tbl;
      case "unwrap": {                       // split a wrapped single-column csv into columns
        if (H.length !== 1) return tbl;
        var inner = [H[0]].concat(R.map(function (r) { return r[0]; })).join("\n");
        var re = parse(inner, {});
        return { headers: re.headers, rows: re.rows };
      }
      case "repair": {                       // fix mojibake (windows-1252 → UTF-8); U+FFFD heuristic: é between letters
        var fix = function (v) { return String(v).replace(/Ã©/g, "é").replace(/Ã¨/g, "è").replace(/Ã /g, "à").replace(/Ã´/g, "ô").replace(/Ã§/g, "ç").replace(/([a-zA-Z])\uFFFD([a-zA-Z])/g, "$1é$2").replace(/\uFFFD/g, "é"); };
        var ci = p.col ? ix(p.col) : -1;
        return { headers: H.slice(), rows: R.map(function (r) { return r.map(function (v, c) { return (ci === -1 || c === ci) ? fix(v) : v; }); }) };
      }
      case "clean": {                        // sentinels → null (empty string)
        var cj = p.col ? ix(p.col) : -1;
        return { headers: H.slice(), rows: R.map(function (r) { return r.map(function (v, c) { return ((cj === -1 || c === cj) && isSentinel(String(v).trim()) && String(v).trim().length) ? "" : v; }); }) };
      }
      case "rename": {
        if (p.mode === "dots") return { headers: H.map(function (h) { return h.replace(/\./g, "_"); }), rows: R };
        if (p.mode === "snake") return { headers: H.map(function (h) { return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }), rows: R };
        var i2 = ix(p.from); if (i2 === -1) return tbl;
        var H2 = H.slice(); H2[i2] = p.to; return { headers: H2, rows: R };
      }
      case "drop": {
        if (p.nulls) { var dn = p.col ? ix(p.col) : -1; return { headers: H.slice(), rows: R.filter(function (r) { return dn === -1 ? r.some(function (v) { return String(v).trim().length; }) : String(r[dn]).trim().length; }) }; }
        var drops = (p.cols || []).map(ix).filter(function (i) { return i !== -1; });
        return { headers: H.filter(function (_, i) { return drops.indexOf(i) === -1; }), rows: R.map(function (r) { return r.filter(function (_, i) { return drops.indexOf(i) === -1; }); }) };
      }
      case "keep": {
        var keeps = (p.cols || []).map(ix).filter(function (i) { return i !== -1; });
        return { headers: keeps.map(function (i) { return H[i]; }), rows: R.map(function (r) { return keeps.map(function (i) { return r[i]; }); }) };
      }
      case "filter": {
        var fi = ix(p.col); if (fi === -1) return tbl;
        var val = String(p.value == null ? "" : p.value), num = parseFloat(val), op = p.op || "=";
        var test = function (v) {
          var s = String(v).trim();
          if (op === "contains") return s.toLowerCase().indexOf(val.toLowerCase()) !== -1;
          if (op === "startswith") return s.toLowerCase().indexOf(val.toLowerCase()) === 0;
          if (op === "endswith") { var lv = val.toLowerCase(), ls = s.toLowerCase(); return ls.length >= lv.length && ls.lastIndexOf(lv) === ls.length - lv.length; }
          var eq = s.toLowerCase() === val.toLowerCase();
          if (op === "=") return eq; if (op === "!=") return !eq;
          var nv = parseFloat(s); if (isNaN(nv) || isNaN(num)) return false;
          if (op === ">") return nv > num; if (op === ">=") return nv >= num; if (op === "<") return nv < num; if (op === "<=") return nv <= num;
          return false;
        };
        return { headers: H.slice(), rows: R.filter(function (r) { return test(r[fi]); }) };
      }
      case "update": {                       // SET col=value WHERE (whereCol op whereVal) — nacl set/on
        var wi = p.whereCol != null ? ix(p.whereCol) : -1, si = ix(p.setCol);
        if (si === -1) return tbl;
        var wv = String(p.whereValue == null ? "" : p.whereValue).toLowerCase();
        var hit = 0;
        var rows2 = R.map(function (r) {
          if (wi === -1 || String(r[wi]).trim().toLowerCase() === wv) { hit++; var r2 = r.slice(); r2[si] = p.setValue; return r2; }
          return r;
        });
        tbl.lastAffected = hit;
        return { headers: H.slice(), rows: rows2, lastAffected: hit };
      }
      case "delete": {
        var di = ix(p.whereCol); if (di === -1) return tbl;
        var dv = String(p.whereValue == null ? "" : p.whereValue).toLowerCase();
        var kept = R.filter(function (r) { return String(r[di]).trim().toLowerCase() !== dv; });
        return { headers: H.slice(), rows: kept, lastAffected: R.length - kept.length };
      }
      case "sort": {
        var si2 = ix(p.col); if (si2 === -1) return tbl;
        var dir = p.desc ? -1 : 1;
        var rows3 = R.slice().sort(function (a, b) {
          var av = a[si2], bv = b[si2], an = parseFloat(av), bn = parseFloat(bv);
          if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });
        return { headers: H.slice(), rows: rows3 };
      }
      case "dedupe": {
        var seen = {}, out = [];
        R.forEach(function (r) { var k = r.join("\u0001"); if (!seen[k]) { seen[k] = 1; out.push(r); } });
        return { headers: H.slice(), rows: out };
      }
      default: return tbl;
    }
  }
  function replay(blobText, steps, opts) {
    var p = parse(blobText, opts || {});
    var tbl = { headers: p.headers, rows: p.rows };
    (steps || []).forEach(function (s) { if (s.kind !== "original") tbl = applyStep(tbl, s); });
    return tbl;
  }

  /* — group-by for chart/pivot: agg ∈ count|sum|mean|min|max — */
  function groupBy(tbl, byCol, agg, measureCol, limit) {
    var bi = tbl.headers.findIndex(function (h) { return h.toLowerCase() === String(byCol).toLowerCase(); });
    if (bi === -1) return [];
    var mi = measureCol ? tbl.headers.findIndex(function (h) { return h.toLowerCase() === String(measureCol).toLowerCase(); }) : -1;
    var acc = {};
    tbl.rows.forEach(function (r) {
      var k = String(r[bi]).trim() || "(null)";
      var a = acc[k] || (acc[k] = { n: 0, sum: 0, min: Infinity, max: -Infinity });
      a.n++;
      if (mi !== -1) { var v = parseFloat(r[mi]); if (!isNaN(v)) { a.sum += v; a.min = Math.min(a.min, v); a.max = Math.max(a.max, v); } }
    });
    var out = Object.keys(acc).map(function (k) {
      var a = acc[k], v = a.n;
      if (agg === "sum") v = Math.round(a.sum * 100) / 100; else if (agg === "mean") v = Math.round(100 * a.sum / Math.max(1, a.n)) / 100;
      else if (agg === "min") v = a.min === Infinity ? 0 : a.min; else if (agg === "max") v = a.max === -Infinity ? 0 : a.max;
      return { label: k, value: v };
    }).sort(function (a, b) { return b.value - a.value; });
    return out.slice(0, limit || 12);
  }

  return { parse: parse, summarize: summarize, cleanness: cleanness, applyStep: applyStep, replay: replay,
           groupBy: groupBy, isSentinel: isSentinel, SENTINELS: SENTINELS };
});

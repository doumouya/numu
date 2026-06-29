/* numu-charts.js — shared chart logic for numu Data (Charts tab) + numu Designer.
   Pure aggregation + ECharts option/theme builders, derived from the numu design
   tokens (steel accent + --chart-1..8). Mirrors the repo's report-spec AggFns and
   the chart-editor cfg shape; the persisted spec is recipe-only (no baked data).
   window.NUMU_CHARTS = { AGG_FNS, CHART_TYPES, aggregate, buildOption, echartsTheme } */
(function () {
  // report vocabulary (shared::report::AggFn) — same set as report-spec.js
  var AGG_FNS = [
    { value: "count", label: "Count", labelFr: "Compte", needsCol: false },
    { value: "count_distinct", label: "Count distinct", labelFr: "Distinct", needsCol: true },
    { value: "sum", label: "Sum", labelFr: "Somme", needsCol: true },
    { value: "mean", label: "Mean", labelFr: "Moyenne", needsCol: true },
    { value: "min", label: "Min", labelFr: "Min", needsCol: true },
    { value: "max", label: "Max", labelFr: "Max", needsCol: true },
    { value: "first", label: "First", labelFr: "Premier", needsCol: true },
    { value: "last", label: "Last", labelFr: "Dernier", needsCol: true },
    { value: "median", label: "Median", labelFr: "Médiane", needsCol: true },
    { value: "q1", label: "Q1 (25%)", labelFr: "Q1 (25%)", needsCol: true },
    { value: "q3", label: "Q3 (75%)", labelFr: "Q3 (75%)", needsCol: true }
  ];
  var CHART_TYPES = [
    { value: "bar", kind: "cartesian", label: "Bar", labelFr: "Barres", icon: "bar-chart" },
    { value: "line", kind: "cartesian", label: "Line", labelFr: "Lignes", icon: "graph-up" },
    { value: "area", kind: "cartesian", label: "Area", labelFr: "Aire", icon: "graph-up" },
    { value: "pie", kind: "pie", label: "Pie", labelFr: "Camembert", icon: "pie-chart" },
    { value: "donut", kind: "pie", label: "Donut", labelFr: "Anneau", icon: "pie-chart" },
    { value: "stacked", kind: "cartesian", label: "Stacked", labelFr: "Empilé", icon: "bar-chart-steps" },
    { value: "kpi", kind: "kpi", label: "KPI", labelFr: "Indicateur", icon: "123" },
    { value: "table", kind: "table", label: "Table", labelFr: "Tableau", icon: "table" },
    { value: "pivot", kind: "pivot", label: "Pivot", labelFr: "Pivot", icon: "table" }
  ];
  // window transforms (faithful to shared::report::WindowSpec): pct = as_percent
  // aggregate window (partition none/col/row), delta/pct_delta = lag(1) value window.
  var WINDOW_MODES = [
    { value: "none", label: "Actual", labelFr: "Valeur", pivotOnly: false },
    { value: "pct", label: "% of total", labelFr: "% du total", pivotOnly: false },
    { value: "pct_col", label: "% of column", labelFr: "% colonne", pivotOnly: true },
    { value: "pct_row", label: "% of row", labelFr: "% ligne", pivotOnly: true },
    { value: "delta", label: "Δ vs previous", labelFr: "Δ vs précéd.", pivotOnly: false },
    { value: "pct_delta", label: "% Δ vs previous", labelFr: "% Δ vs précéd.", pivotOnly: false },
    { value: "lead", label: "Next value", labelFr: "Valeur suivante", pivotOnly: false },
    { value: "first_value", label: "First value", labelFr: "Première valeur", pivotOnly: false },
    { value: "last_value", label: "Last value", labelFr: "Dernière valeur", pivotOnly: false }
  ];

  // single whole-dataset aggregate for KPI tiles (no group-by, no topN cap)
  function kpi(source, opts) {
    var cols = source.columns || [], rows = source.rows || [];
    var fn = (opts && opts.fn) || "count"; var ci = (opts && opts.col != null) ? idxOf(cols, opts.col) : -1;
    if (fn === "count") return rows.length;
    if (fn === "count_distinct") { var s = new Set(); rows.forEach(function (r) { var v = ci >= 0 ? r[ci] : null; if (!isNull(v)) s.add(String(v)); }); return s.size; }
    var acc = newAcc(); rows.forEach(function (r) { feed(acc, fn, ci >= 0 ? r[ci] : null); }); return applyAgg(fn, acc);
  }
  function isNull(v) { return v === null || v === undefined || v === "" || v === "NA" || v === "N/A"; }
  function cn(c) { return c && (c.name != null ? c.name : c.n); }
  function idxOf(cols, name) { for (var i = 0; i < cols.length; i++) { if (String(cn(cols[i])).toLowerCase() === String(name).toLowerCase()) return i; } return -1; }
  function monthOf(v) { var m = /^(\d{4})[\/-](\d{2})/.exec(String(v)); return m ? m[1] + "-" + m[2] : String(v); }

  // linear-interpolated quantile over an accumulator's collected numeric values
  // (matches the engine's Polars QuantileMethod::Linear for median/q1/q3).
  function quant(acc, p) {
    if (!acc.vals || !acc.vals.length) return 0;
    var s = acc.vals.slice().sort(function (a, b) { return a - b; });
    var pos = (s.length - 1) * p, b = Math.floor(pos), rest = pos - b;
    var v = s[b + 1] !== undefined ? s[b] + rest * (s[b + 1] - s[b]) : s[b];
    return Math.round(v * 100) / 100;
  }
  function applyAgg(fn, acc) {
    switch (fn) {
      case "count": return acc.cnt;
      case "count_distinct": return acc.set.size;
      case "sum": return Math.round(acc.sum * 100) / 100;
      case "mean": return acc.n ? Math.round((acc.sum / acc.n) * 100) / 100 : 0;
      case "min": return acc.min === Infinity ? 0 : acc.min;
      case "max": return acc.max === -Infinity ? 0 : acc.max;
      case "median": return quant(acc, 0.5);
      case "q1": return quant(acc, 0.25);
      case "q3": return quant(acc, 0.75);
      case "first": return acc.firstV == null ? "" : acc.firstV;
      case "last": return acc.lastV == null ? "" : acc.lastV;
      default: return acc.cnt;
    }
  }
  function newAcc() { return { cnt: 0, sum: 0, n: 0, min: Infinity, max: -Infinity, set: new Set(), vals: [], firstV: null, lastV: null }; }
  function feed(acc, fn, raw) {
    acc.cnt++;
    if (fn === "first" || fn === "last") { if (!isNull(raw)) { if (acc.firstV === null) acc.firstV = raw; acc.lastV = raw; } return; }
    if (fn === "count_distinct") { if (!isNull(raw)) acc.set.add(String(raw)); return; }
    if (fn === "count") return;
    var num = Number(raw); if (isNaN(num)) return;
    acc.sum += num; acc.n++; if (num < acc.min) acc.min = num; if (num > acc.max) acc.max = num;
    if (fn === "median" || fn === "q1" || fn === "q3") acc.vals.push(num);
  }

  // aggregate(source, { groupBy, fn, col, bucket?, stackBy?, topN? })
  // → { dims:[], values:[], pairs:[{name,value}], series:[{name,data:[]}], stacks:[], total }
  function aggregate(source, opts) {
    opts = opts || {};
    var cols = source.columns || [], rows = source.rows || [];
    var gi = idxOf(cols, opts.groupBy), ci = opts.col != null ? idxOf(cols, opts.col) : -1;
    var si = opts.stackBy ? idxOf(cols, opts.stackBy) : -1;
    var fn = opts.fn || "count", bucket = opts.bucket || "none";
    var map = new Map(), stackSet = new Set();
    if (gi < 0) return { dims: [], values: [], pairs: [], series: [], stacks: [], total: 0 };
    rows.forEach(function (r) {
      var raw = r[gi]; if (isNull(raw)) return;
      var dim = bucket === "month" ? monthOf(raw) : String(raw);
      var stack = si >= 0 ? (isNull(r[si]) ? "—" : String(r[si])) : "_";
      if (si >= 0) stackSet.add(stack);
      if (!map.has(dim)) map.set(dim, {});
      var g = map.get(dim);
      if (!g[stack]) g[stack] = newAcc();
      feed(g[stack], fn, ci >= 0 ? r[ci] : null);
    });
    var entries = [];
    map.forEach(function (g, dim) {
      var total = 0; var byStack = {};
      Object.keys(g).forEach(function (s) { var v = applyAgg(fn, g[s]); byStack[s] = v; total += v; });
      entries.push({ dim: dim, total: total, byStack: byStack });
    });
    // sort: month buckets chronologically; else by total desc
    if (bucket === "month") entries.sort(function (a, b) { return a.dim < b.dim ? -1 : 1; });
    else entries.sort(function (a, b) { return b.total - a.total; });
    var grandTotal = entries.reduce(function (a, e) { return a + e.total; }, 0);
    var topN = opts.topN || (bucket === "month" ? 36 : 14);
    if (entries.length > topN) entries = entries.slice(0, topN);
    var dims = entries.map(function (e) { return e.dim; });
    var values = entries.map(function (e) { return e.total; });
    var stacks = si >= 0 ? Array.from(stackSet) : [];
    var series = si >= 0
      ? stacks.map(function (s) { return { name: s, data: entries.map(function (e) { return e.byStack[s] || 0; }) }; })
      : [{ name: opts.alias || fn, data: values }];
    var win = opts.window || "none";
    if (win !== "none" && series.length) {
      var pctMode = (win === "pct" || win === "pct_col" || win === "pct_row");
      var tx = function (arr) {
        if (pctMode) { var s = arr.reduce(function (a, b) { return a + (+b || 0); }, 0) || 1; return arr.map(function (v) { return Math.round((+v || 0) / s * 1000) / 10; }); }
        if (win === "delta") { return arr.map(function (v, i) { return i === 0 ? 0 : Math.round(((+v || 0) - (+arr[i - 1] || 0)) * 100) / 100; }); }
        if (win === "pct_delta") { return arr.map(function (v, i) { var p = +arr[i - 1] || 0; return (i === 0 || !p) ? 0 : Math.round(((+v || 0) - p) / p * 1000) / 10; }); }
        if (win === "lead") { return arr.map(function (v, i) { return i < arr.length - 1 ? arr[i + 1] : null; }); }
        if (win === "first_value") { var f = arr.length ? arr[0] : null; return arr.map(function () { return f; }); }
        if (win === "last_value") { var l = arr.length ? arr[arr.length - 1] : null; return arr.map(function () { return l; }); }
        return arr;
      };
      series = series.map(function (s) { return { name: s.name, data: tx(s.data) }; });
      values = series[0] ? series[0].data.slice() : values;
    }
    return { dims: dims, values: values, pairs: dims.map(function (d, i) { return { name: d, value: values[i] }; }), series: series, stacks: stacks, total: grandTotal, window: win };
  }

  // buildOption(cfg, agg) → ECharts option (colors come from the registered theme)
  function buildOption(cfg, agg) {
    var type = cfg.type || "bar";
    var legendPos = cfg.legendPos || "top";
    var legend = cfg.legend ? { show: true, type: "scroll", top: legendPos === "top" ? 0 : undefined, bottom: legendPos === "bottom" ? 0 : undefined, left: "center" } : { show: false };
    var topPad = cfg.legend && legendPos === "top" ? 28 : 12;
    if (type === "pie" || type === "donut") {
      return {
        legend: cfg.legend ? { show: true, type: "scroll", orient: "vertical", left: 0, top: "middle" } : { show: false },
        tooltip: { show: cfg.tooltip !== false, trigger: "item", formatter: "{b}: {c} ({d}%)" },
        series: [{
          type: "pie", radius: type === "donut" ? ["46%", "72%"] : "72%", center: cfg.legend ? ["62%", "52%"] : ["50%", "52%"],
          data: agg.pairs, label: { show: !cfg.legend && agg.pairs.length <= 8 }, labelLine: { show: !cfg.legend && agg.pairs.length <= 8 },
          itemStyle: { borderWidth: 1 }
        }]
      };
    }
    var pctY = (cfg.window === "pct" || cfg.window === "pct_col" || cfg.window === "pct_row" || cfg.window === "pct_delta");
    var isStacked = type === "stacked";
    var series = agg.series.map(function (s) {
      var base = { name: s.name, data: s.data };
      if (type === "line" || type === "area") { base.type = "line"; base.smooth = false; if (type === "area") base.areaStyle = { opacity: 0.18 }; base.symbolSize = 5; }
      else { base.type = "bar"; base.barMaxWidth = 38; if (isStacked) base.stack = "total"; base.itemStyle = { borderRadius: isStacked ? 0 : [3, 3, 0, 0] }; }
      return base;
    });
    return {
      grid: { left: 8, right: 14, top: topPad, bottom: 6, containLabel: true },
      legend: (cfg.legend && (isStacked || agg.series.length > 1)) ? legend : { show: false },
      tooltip: { show: cfg.tooltip !== false, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: pctY ? function (v) { return (v == null ? "" : v) + "%"; } : undefined },
      xAxis: { type: "category", data: agg.dims, axisLabel: { interval: 0, rotate: agg.dims.length > 6 ? 38 : 0, hideOverlap: true } },
      yAxis: { type: "value", axisLabel: pctY ? { formatter: "{value}%" } : {} },
      series: series
    };
  }

  // echartsTheme(T) → ECharts theme object from resolved token hexes.
  // T = { color:[8 hex], text, textMuted, textSubtle, border, surface, tooltipBg, tooltipBorder }
  function echartsTheme(T) {
    var axisLine = { show: false, lineStyle: { color: T.border } };
    var axisTick = { show: false };
    var split = { show: true, lineStyle: { color: [T.border], type: "dashed", opacity: 0.6 } };
    return {
      color: T.color,
      backgroundColor: "transparent",
      textStyle: { color: T.text, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
      title: { textStyle: { color: T.text, fontWeight: 600 }, subtextStyle: { color: T.textMuted } },
      legend: { textStyle: { color: T.textMuted }, icon: "roundRect", itemWidth: 13, itemHeight: 8 },
      tooltip: { backgroundColor: T.tooltipBg, borderColor: T.tooltipBorder, borderWidth: 1, textStyle: { color: T.text }, axisPointer: { type: "shadow", shadowStyle: { color: "rgba(63,85,115,0.08)" } } },
      categoryAxis: { axisLine: axisLine, axisTick: axisTick, axisLabel: { color: T.textMuted, fontSize: 11 }, splitLine: { show: false } },
      valueAxis: { axisLine: axisLine, axisTick: axisTick, axisLabel: { color: T.textSubtle, fontSize: 10 }, splitLine: split },
      line: { lineStyle: { width: 2 }, symbol: "circle", symbolSize: 5 },
      bar: { itemStyle: { borderRadius: [3, 3, 0, 0] } },
      pie: { itemStyle: { borderColor: T.surface, borderWidth: 1 } }
    };
  }

  // ---- pivot (faithful to shared::report::ReportSpec) -------------------
  // rows = group_by, cols = group_by_cols (one dim for this surface),
  // measures = aggregations (one or more). Returns a render-ready matrix model
  // (display strings included) so PivotTable stays pure markup.
  function fmtNum(v) { if (v == null || v === "") return ""; if (typeof v === "number") return (Math.round(v * 100) / 100).toLocaleString(); return String(v); }
  function measureLabel(m, lang) { var f = null; for (var i = 0; i < AGG_FNS.length; i++) { if (AGG_FNS[i].value === m.fn) { f = AGG_FNS[i]; break; } } var fl = f ? (lang === "fr" ? f.labelFr : f.label) : m.fn; return m.fn === "count" ? fl : fl + " " + (m.col || ""); }
  function pivot(source, spec, lang) {
    lang = lang || "en";
    var cols = source.columns || [], rows = source.rows || [];
    var rowDims = (spec.rows || []).filter(Boolean);
    var colDims = (spec.cols || []).filter(Boolean);
    var measures = (spec.measures && spec.measures.length) ? spec.measures : [{ fn: "count", col: null }];
    var bucket = spec.bucket || "none";
    var rIdx = rowDims.map(function (n) { return idxOf(cols, n); });
    var cIdx = colDims.length ? idxOf(cols, colDims[0]) : -1;
    var mIdx = measures.map(function (m) { return m.col != null ? idxOf(cols, m.col) : -1; });
    var rowOrder = [], rowSeen = {}, colSet = new Set(), data = new Map();
    rows.forEach(function (r) {
      for (var k = 0; k < rIdx.length; k++) { if (rIdx[k] < 0 || isNull(r[rIdx[k]])) return; }
      var rk = rIdx.map(function (i, j) { var v = r[i]; return (bucket === "month" && j === 0) ? monthOf(v) : String(v); }).join("  ·  ");
      var ck = cIdx >= 0 ? (isNull(r[cIdx]) ? "—" : String(r[cIdx])) : "_";
      if (cIdx >= 0) colSet.add(ck);
      if (!rowSeen[rk]) { rowSeen[rk] = true; rowOrder.push(rk); }
      if (!data.has(rk)) data.set(rk, {});
      var byCol = data.get(rk);
      if (!byCol[ck]) byCol[ck] = measures.map(function () { return newAcc(); });
      measures.forEach(function (m, mi) { feed(byCol[ck][mi], m.fn, mIdx[mi] >= 0 ? r[mIdx[mi]] : null); });
    });
    var colKeys = cIdx >= 0 ? Array.from(colSet) : ["_"];
    colKeys.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    if (colKeys.length > 12) colKeys = colKeys.slice(0, 12);
    var hasCol = cIdx >= 0, multiMeas = measures.length > 1, hasGroups = hasCol && multiMeas;
    var additive = measures[0].fn === "count" || measures[0].fn === "sum";
    var columns = [], groups = [];
    if (hasCol) {
      colKeys.forEach(function (ck) {
        groups.push({ label: ck, span: measures.length });
        measures.forEach(function (m, mi) { columns.push({ ck: ck, mi: mi, label: multiMeas ? measureLabel(m, lang) : ck }); });
      });
    } else {
      measures.forEach(function (m, mi) { columns.push({ ck: "_", mi: mi, label: measureLabel(m, lang) }); });
    }
    function cell(rk, ck, mi) { var bc = data.get(rk); if (!bc || !bc[ck]) return null; return applyAgg(measures[mi].fn, bc[ck][mi]); }
    var win = spec.window || "none";
    var isPct = (win === "pct" || win === "pct_col" || win === "pct_row" || win === "pct_delta");
    var raw = rowOrder.map(function (rk) { return columns.map(function (c) { var v = cell(rk, c.ck, c.mi); return typeof v === "number" ? v : null; }); });
    var rawColTot = columns.map(function (c, ci) { return raw.reduce(function (a, row) { return a + (row[ci] || 0); }, 0); });
    var rawRowTot = raw.map(function (row) { return row.reduce(function (a, v) { return a + (v || 0); }, 0); });
    var rawGrand = rawColTot.reduce(function (a, b) { return a + b; }, 0);
    function applyWin(val, ri, ci) {
      if (win === "none" || val == null || typeof val !== "number") return val;
      if (win === "pct") return rawGrand ? val / rawGrand * 100 : 0;
      if (win === "pct_col") return rawColTot[ci] ? val / rawColTot[ci] * 100 : 0;
      if (win === "pct_row") return rawRowTot[ri] ? val / rawRowTot[ri] * 100 : 0;
      if (win === "delta") { var p = ci > 0 ? raw[ri][ci - 1] : null; return p == null ? null : val - p; }
      if (win === "pct_delta") { var q = ci > 0 ? raw[ri][ci - 1] : null; return (q == null || !q) ? null : (val - q) / q * 100; }
      if (win === "lead") { return ci < raw[ri].length - 1 ? raw[ri][ci + 1] : null; }
      if (win === "first_value") { return raw[ri][0]; }
      if (win === "last_value") { var row = raw[ri]; return row[row.length - 1]; }
      return val;
    }
    function fmtCell(val) {
      if (val == null || val === "") return "";
      if (typeof val !== "number") return String(val);
      if (isPct) return (Math.round(val * 10) / 10).toLocaleString() + "%";
      if (win === "delta") { var r = Math.round(val * 100) / 100; return (r > 0 ? "+" : "") + r.toLocaleString(); }
      return fmtNum(val);
    }
    var order = rowOrder.map(function (rk, ri) { return { rk: rk, ri: ri }; });
    if (bucket !== "month") order.sort(function (a, b) { return (raw[b.ri][0] || 0) - (raw[a.ri][0] || 0); });
    if (order.length > 80) order = order.slice(0, 80);
    var outRows = order.map(function (o) {
      var ri = o.ri;
      var cells = columns.map(function (c, ci) { var v = cell(o.rk, c.ck, c.mi); return (typeof v === "number") ? { display: fmtCell(applyWin(v, ri, ci)) } : { display: fmtNum(v) }; });
      var total = (win === "none" && hasCol && additive) ? rawRowTot[ri] : null;
      return { label: o.rk, cells: cells, total: total != null ? fmtNum(total) : null };
    });
    var showTotalCol = hasCol && additive && win === "none";
    var showTotalRow = additive && win === "none";
    var colTotals = showTotalRow ? columns.map(function (c, ci) { return fmtNum(rawColTot[ci]); }) : [];
    var grand = showTotalCol ? fmtNum(rawGrand) : null;
    return {
      rowDimLabel: rowDims.join(" · ") || (lang === "fr" ? "(tout)" : "(all)"),
      hasGroups: hasGroups, groups: hasGroups ? groups : [], columns: columns.map(function (c) { return { label: c.label }; }),
      rows: outRows, rowCount: rowOrder.length,
      showTotalCol: showTotalCol, totalInGroupRow: hasGroups && showTotalCol, totalInLeafRow: showTotalCol && !hasGroups,
      showTotalRow: showTotalRow, colTotals: colTotals, grandTotal: grand,
      totalColLabel: lang === "fr" ? "Total" : "Total", totalRowLabel: lang === "fr" ? "Total" : "Total",
      measureSummary: measures.map(function (m) { return measureLabel(m, lang); }).join(", ")
    };
  }

  window.NUMU_CHARTS = { AGG_FNS: AGG_FNS, CHART_TYPES: CHART_TYPES, WINDOW_MODES: WINDOW_MODES, aggregate: aggregate, kpi: kpi, pivot: pivot, measureLabel: measureLabel, buildOption: buildOption, echartsTheme: echartsTheme, monthOf: monthOf };
})();

/* @ds-bundle: {"format":3,"namespace":"DatacoreDesignSystem_a460c7","components":[{"name":"Chart","sourcePath":"components/charts/Chart.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Code","sourcePath":"components/display/Code.jsx"},{"name":"EmptyState","sourcePath":"components/display/EmptyState.jsx"},{"name":"Icon","sourcePath":"components/display/Icon.jsx"},{"name":"KindLabel","sourcePath":"components/display/KindLabel.jsx"},{"name":"Stat","sourcePath":"components/display/Stat.jsx"},{"name":"Toolbar","sourcePath":"components/display/Toolbar.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/charts/Chart.jsx":"af66483dcc86","components/display/Avatar.jsx":"952874a5fff6","components/display/Badge.jsx":"51b691ecf59a","components/display/Card.jsx":"9da81a52a1a2","components/display/Code.jsx":"5153df7e2141","components/display/EmptyState.jsx":"3c45b08bb49e","components/display/Icon.jsx":"129d8ea84526","components/display/KindLabel.jsx":"f3921a35a6ee","components/display/Stat.jsx":"97d64caeaf64","components/display/Toolbar.jsx":"fc17eb2a7690","components/feedback/Dialog.jsx":"fcc88993ab19","components/feedback/Toast.jsx":"bdc8d014ed20","components/feedback/Tooltip.jsx":"508bd702ecea","components/forms/Button.jsx":"925486ed60ed","components/forms/Checkbox.jsx":"9ebac9229dd4","components/forms/IconButton.jsx":"5e51754c7be3","components/forms/Input.jsx":"187a0cb55435","components/forms/Select.jsx":"325672a9bb8c","components/navigation/Tabs.jsx":"5080071e7f43","ui_kits/build-engine/BuildEngineApp.jsx":"39c70032f400","ui_kits/build-engine/CaseBoard.jsx":"2b17dfd98702","ui_kits/build-engine/CaseDetail.jsx":"96d4e4870ac6","ui_kits/build-engine/CaseList.jsx":"b2c0369741cf","ui_kits/build-engine/NewCaseDialog.jsx":"d8cf859fe281","ui_kits/build-engine/WorkflowStepper.jsx":"a2dd90c1cf50","ui_kits/build-engine/engine.js":"044e0db27a83","ui_kits/datatable/ColumnManager.jsx":"d4375b77c889","ui_kits/datatable/DataGrid.jsx":"c8270011c656","ui_kits/datatable/DatatableApp.jsx":"51a6dd31ac81","ui_kits/datatable/FilterPopover.jsx":"5e2e684622e4","ui_kits/datatable/Pagination.jsx":"c3fbb25ad1b6","ui_kits/datatable/tableEngine.js":"76a89ae9e892","ui_kits/echarts-dashboard/ChartCard.jsx":"9ef855055fb7","ui_kits/echarts-dashboard/EchartsDashboardApp.jsx":"c9771be32aa7","ui_kits/echarts-dashboard/aggregateEngine.js":"a53119bfc8eb","ui_kits/rbac-explorer/RbacExplorerApp.jsx":"807101e7edd0","ui_kits/rbac-explorer/RbacTree.jsx":"85ecac1b06c1","ui_kits/rbac-explorer/ReachPanel.jsx":"d0e8d49f6777","ui_kits/rbac-explorer/rbacEngine.js":"f16d97de4b0b"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DatacoreDesignSystem_a460c7 = window.DatacoreDesignSystem_a460c7 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/charts/Chart.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Chart — a thin React wrapper around ECharts that themes it from the
   live design tokens. It reads --chart-1..8 + the structural chart tokens off
   the computed style, registers an ECharts theme, and re-applies it on
   light/dark change — so charts always match the page. Manages init / setOption
   / resize (ResizeObserver) / dispose. ECharts itself is NOT bundled: the host
   must load it as the global `echarts` (the dashboard product vendors it; a kit
   may use the CDN). Pass a standard ECharts `option`. */

let themeSeq = 0;
function readTheme(el) {
  const cs = getComputedStyle(el);
  const v = (n, f) => cs.getPropertyValue(n).trim() || f;
  const colors = [1, 2, 3, 4, 5, 6, 7, 8].map(i => v(`--chart-${i}`, "#2563eb"));
  const axis = v("--chart-axis", "#6b7280");
  const grid = v("--chart-grid", "#e5e7eb");
  const text = v("--text", "#1f2937");
  const font = v("--font-sans", "system-ui, sans-serif");
  const tipBg = v("--chart-tooltip-bg", "#fff");
  const tipBorder = v("--chart-tooltip-border", "#e5e7eb");
  const tipText = v("--chart-tooltip-text", "#1f2937");
  const axisCommon = {
    axisLine: {
      lineStyle: {
        color: grid
      }
    },
    axisTick: {
      lineStyle: {
        color: grid
      }
    },
    axisLabel: {
      color: axis
    },
    splitLine: {
      lineStyle: {
        color: grid,
        type: "dashed"
      }
    }
  };
  return {
    color: colors,
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: font,
      color: text
    },
    title: {
      textStyle: {
        color: text,
        fontWeight: 600
      },
      subtextStyle: {
        color: axis
      }
    },
    legend: {
      textStyle: {
        color: axis
      }
    },
    categoryAxis: {
      ...axisCommon,
      splitLine: {
        show: false
      }
    },
    valueAxis: axisCommon,
    grid: {
      borderColor: grid
    },
    tooltip: {
      backgroundColor: tipBg,
      borderColor: tipBorder,
      borderWidth: 1,
      textStyle: {
        color: tipText,
        fontFamily: font,
        fontSize: 12
      },
      extraCssText: "box-shadow:0 4px 12px -2px rgba(15,23,42,.12); border-radius:8px;"
    },
    line: {
      symbolSize: 6,
      lineStyle: {
        width: 2
      },
      smooth: true
    },
    bar: {
      itemStyle: {
        borderRadius: [3, 3, 0, 0]
      }
    },
    pie: {
      itemStyle: {
        borderColor: v("--surface", "#fff"),
        borderWidth: 2
      }
    }
  };
}
function Chart({
  option,
  notMerge = true,
  themeKey,
  onReady,
  className = "",
  style,
  ...rest
}) {
  const hostRef = React.useRef(null);
  const instRef = React.useRef(null);
  const themeName = React.useRef("dc-chart-" + themeSeq++);
  const [missing, setMissing] = React.useState(false);

  // (re)create the instance whenever the theme should change
  const build = React.useCallback(() => {
    const ec = typeof window !== "undefined" && window.echarts;
    if (!ec || !hostRef.current) {
      setMissing(!ec);
      return;
    }
    setMissing(false);
    ec.registerTheme(themeName.current, readTheme(hostRef.current));
    if (instRef.current) instRef.current.dispose();
    instRef.current = ec.init(hostRef.current, themeName.current, {
      renderer: "canvas"
    });
    if (option) instRef.current.setOption(option, notMerge);
    if (onReady) onReady(instRef.current);
  }, []); // eslint-disable-line

  React.useEffect(() => {
    build();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => build();
    mq.addEventListener && mq.addEventListener("change", onScheme);
    const ro = new ResizeObserver(() => instRef.current && instRef.current.resize());
    if (hostRef.current) ro.observe(hostRef.current);
    return () => {
      mq.removeEventListener && mq.removeEventListener("change", onScheme);
      ro.disconnect();
      if (instRef.current) {
        instRef.current.dispose();
        instRef.current = null;
      }
    };
  }, [build]);

  // rebuild on explicit themeKey change (e.g. forced [data-theme] toggle)
  React.useEffect(() => {
    if (themeKey !== undefined) build();
  }, [themeKey]); // eslint-disable-line

  // push new options without re-creating the instance
  React.useEffect(() => {
    if (instRef.current && option) instRef.current.setOption(option, notMerge);
  }, [option, notMerge]);
  return /*#__PURE__*/React.createElement("div", _extends({
    ref: hostRef,
    className: `dc-chart ${className}`.trim(),
    style: {
      width: "100%",
      height: "16rem",
      minHeight: "8rem",
      ...style
    }
  }, rest), missing && /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--text-subtle)",
      fontSize: "var(--text-sm)",
      fontFamily: "var(--font-mono)"
    }
  }, "echarts not loaded"));
}
Object.assign(__ds_scope, { Chart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/Chart.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Badge — a compact status pill. Neutral + semantic tones, plus the
   four build-engine workflow states (backlog / progress / review / done).
   Three fills: soft (tinted, default), solid, outline. Optional leading dot. */

const CSS = `
.dc-badge{
  --tone: var(--text-muted);
  display:inline-flex; align-items:center; gap:var(--space-1);
  height:1.4rem; padding:0 var(--space-2);
  font-size:var(--text-2xs); font-weight:var(--weight-medium); line-height:1;
  letter-spacing:var(--tracking-wide); white-space:nowrap;
  border:var(--border-width) solid transparent; border-radius:var(--radius-full);
}
.dc-badge--square{ border-radius:var(--radius-xs); letter-spacing:0; }
.dc-badge--mono{ font-family:var(--font-mono); letter-spacing:0; text-transform:none; }
.dc-badge__dot{ width:.42rem; height:.42rem; border-radius:var(--radius-full); background:var(--tone); flex:none; }

/* fills */
.dc-badge--soft{ background:color-mix(in srgb, var(--tone) 13%, var(--surface)); color:var(--tone); border-color:color-mix(in srgb, var(--tone) 22%, transparent); }
.dc-badge--solid{ background:var(--tone); color:#fff; border-color:var(--tone); }
.dc-badge--outline{ background:transparent; color:var(--tone); border-color:color-mix(in srgb, var(--tone) 45%, transparent); }

/* tones */
.dc-badge--neutral{ --tone: var(--text-muted); }
.dc-badge--accent{ --tone: var(--accent); }
.dc-badge--success{ --tone: var(--success); }
.dc-badge--warning{ --tone: var(--warning); }
.dc-badge--danger{ --tone: var(--danger); }
.dc-badge--backlog{ --tone: var(--status-backlog); }
.dc-badge--progress{ --tone: var(--status-progress); }
.dc-badge--review{ --tone: var(--status-review); }
.dc-badge--done{ --tone: var(--status-done); }
.dc-badge--neutral.dc-badge--soft{ background:var(--surface-subtle); border-color:var(--border); color:var(--text-muted); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "badge");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Badge({
  tone = "neutral",
  variant = "soft",
  dot = false,
  square = false,
  mono = false,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  const classes = ["dc-badge", `dc-badge--${tone}`, `dc-badge--${variant}`, square && "dc-badge--square", mono && "dc-badge--mono", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    className: "dc-badge__dot",
    "aria-hidden": "true"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Card — a flat, hairline-bordered surface (no drop shadow; depth is
   the border + a subtle surface step, per the brand). Optional header (title +
   actions) and footer. `interactive` highlights the border on hover. */

const CSS = `
.dc-card{
  display:flex; flex-direction:column;
  background:var(--surface); border:var(--border-width) solid var(--border);
  border-radius:var(--radius); overflow:clip;
}
.dc-card--interactive{ cursor:pointer; transition:var(--transition-control); }
.dc-card--interactive:hover{ border-color:var(--accent); }
.dc-card--interactive:focus-visible{ outline:var(--focus-ring); outline-offset:1px; }
.dc-card--raised{ box-shadow:var(--shadow-popover); border-color:transparent; }
.dc-card__header{
  display:flex; align-items:center; gap:var(--space-3);
  padding:var(--space-3) var(--space-4);
  border-bottom:var(--border-width) solid var(--border);
  background:var(--surface-subtle);
}
.dc-card__title{ font-size:var(--text-md); font-weight:var(--weight-semibold); color:var(--text); margin:0; }
.dc-card__subtitle{ font-size:var(--text-sm); color:var(--text-muted); margin:0; }
.dc-card__titles{ display:flex; flex-direction:column; gap:.1rem; min-width:0; }
.dc-card__actions{ margin-left:auto; display:flex; align-items:center; gap:var(--space-2); }
.dc-card__body{ padding:var(--space-4); }
.dc-card__body--flush{ padding:0; }
.dc-card__footer{
  padding:var(--space-3) var(--space-4);
  border-top:var(--border-width) solid var(--border);
  background:var(--surface-subtle);
  font-size:var(--text-sm); color:var(--text-muted);
}
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "card");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Card({
  title,
  subtitle,
  actions,
  footer,
  interactive = false,
  raised = false,
  flush = false,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  const hasHeader = title != null || actions != null;
  const classes = ["dc-card", interactive && "dc-card--interactive", raised && "dc-card--raised", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: classes,
    tabIndex: interactive ? 0 : undefined
  }, rest), hasHeader && /*#__PURE__*/React.createElement("div", {
    className: "dc-card__header"
  }, (title != null || subtitle != null) && /*#__PURE__*/React.createElement("div", {
    className: "dc-card__titles"
  }, title != null && /*#__PURE__*/React.createElement("h3", {
    className: "dc-card__title"
  }, title), subtitle != null && /*#__PURE__*/React.createElement("p", {
    className: "dc-card__subtitle"
  }, subtitle)), actions != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-card__actions"
  }, actions)), /*#__PURE__*/React.createElement("div", {
    className: `dc-card__body${flush ? " dc-card__body--flush" : ""}`
  }, children), footer != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-card__footer"
  }, footer));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Code.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Code — monospace text for identifiers, entity IDs, kinds and JSON.
   Inline by default (a subtle tinted chip); `block` renders a scrollable pre.
   The mono face is a first-class brand element for this developer tool. */

const CSS = `
.dc-code{
  font-family:var(--font-mono); font-size:var(--text-sm);
  font-variant-numeric:var(--numeric-tabular);
}
.dc-code--inline{
  padding:.05rem .3rem; border-radius:var(--radius-xs);
  background:var(--surface-subtle); border:var(--border-width) solid var(--border-subtle);
  color:var(--text); white-space:nowrap;
}
.dc-code--accent{ color:var(--accent); background:var(--accent-tint); border-color:transparent; }
.dc-code--muted{ color:var(--text-muted); }
.dc-code--block{
  display:block; padding:var(--space-3) var(--space-4); margin:0;
  background:var(--surface-subtle); border:var(--border-width) solid var(--border);
  border-radius:var(--radius); color:var(--text);
  font-size:var(--text-sm); line-height:var(--leading); overflow:auto; white-space:pre;
}
.dc-code--truncate{ max-width:14rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; display:inline-block; }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "code");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Code({
  block = false,
  tone = "default",
  truncate = false,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  if (block) {
    return /*#__PURE__*/React.createElement("pre", _extends({
      className: `dc-code dc-code--block ${className}`.trim()
    }, rest), children);
  }
  const classes = ["dc-code", "dc-code--inline", tone !== "default" && `dc-code--${tone}`, truncate && "dc-code--truncate", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("code", _extends({
    className: classes
  }, rest), children);
}
Object.assign(__ds_scope, { Code });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Code.jsx", error: String((e && e.message) || e) }); }

// components/display/EmptyState.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore EmptyState — the datatable's calm drop-zone / zero-data panel.
   Centered, muted, with an optional large glyph, a lead line, a supporting
   line, and an action. Also used as a dashed drop target. */

const CSS = `
.dc-empty{
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:var(--space-3); text-align:center; color:var(--text-muted);
  padding:var(--space-12) var(--space-6); min-height:16rem;
}
.dc-empty--dropzone{
  border:2px dashed var(--border-strong); border-radius:var(--radius-lg);
  background:var(--surface-subtle); transition:var(--transition-control);
}
.dc-empty--dropzone.is-over{ border-color:var(--accent); background:var(--accent-tint); }
.dc-empty__glyph{ font-size:1.9rem; line-height:1; color:var(--text-subtle); }
.dc-empty__lead{ font-size:var(--text-xl); color:var(--text); margin:0; font-weight:var(--weight-medium); }
.dc-empty__desc{ font-size:var(--text-sm); color:var(--text-muted); margin:0; max-width:28rem; }
.dc-empty__action{ margin-top:var(--space-2); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "emptystate");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function EmptyState({
  glyph,
  lead,
  description,
  action,
  dropzone = false,
  over = false,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  const classes = ["dc-empty", dropzone && "dc-empty--dropzone", dropzone && over && "is-over", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: classes
  }, rest), glyph != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-empty__glyph",
    "aria-hidden": "true"
  }, glyph), lead != null && /*#__PURE__*/React.createElement("p", {
    className: "dc-empty__lead"
  }, lead), description != null && /*#__PURE__*/React.createElement("p", {
    className: "dc-empty__desc"
  }, description), children, action != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-empty__action"
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/display/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Icon — the brand icon language. Wraps Bootstrap Icons (loaded from
   CDN, rendered at currentColor) so glyphs inherit text color and sit on the
   baseline. Thin, geometric, single-weight — it matches the hairline aesthetic.
   Pass any Bootstrap Icons name without the `bi-` prefix (e.g. "search",
   "funnel", "arrow-down-up"). */

const BI_HREF = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css";
let fontLinked = false;
function ensureIconFont() {
  if (fontLinked || typeof document === "undefined") return;
  fontLinked = true;
  if (document.querySelector('link[data-dc="bootstrap-icons"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = BI_HREF;
  l.setAttribute("data-dc", "bootstrap-icons");
  document.head.appendChild(l);
}
function Icon({
  name,
  size,
  label,
  className = "",
  style,
  ...rest
}) {
  ensureIconFont();
  const a11y = label ? {
    role: "img",
    "aria-label": label
  } : {
    "aria-hidden": "true"
  };
  return /*#__PURE__*/React.createElement("i", _extends({
    className: `bi bi-${name} ${className}`.trim(),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      fontSize: size,
      ...style
    }
  }, a11y, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Icon.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Avatar — a small identity chip for case assignees and thread authors.
   Shows an image if given, else initials from `name`, else a fallback icon. A
   rounded square by default (matches the brand's small radii); `circle` for
   people. Optional tone tints the fallback. */

const CSS = `
.dc-avatar{
  display:inline-flex; align-items:center; justify-content:center; flex:none;
  width:1.75rem; height:1.75rem; border-radius:var(--radius-sm);
  background:var(--surface-subtle); color:var(--text-muted);
  border:1px solid var(--border); overflow:hidden;
  font-weight:var(--weight-semibold); font-size:var(--text-2xs); line-height:1;
  text-transform:uppercase; letter-spacing:.01em; user-select:none;
}
.dc-avatar--circle{ border-radius:var(--radius-full); }
.dc-avatar--sm{ width:1.4rem; height:1.4rem; font-size:.6rem; }
.dc-avatar--lg{ width:2.25rem; height:2.25rem; font-size:var(--text-sm); }
.dc-avatar img{ width:100%; height:100%; object-fit:cover; }
.dc-avatar--toned{
  background:color-mix(in srgb, var(--tone) 14%, var(--surface));
  color:var(--tone); border-color:color-mix(in srgb, var(--tone) 26%, transparent);
}
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "avatar");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function initials(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).slice(0, 2);
}
function Avatar({
  name,
  src,
  icon = "person-fill",
  shape = "rounded",
  size = "md",
  tone,
  className = "",
  style,
  ...rest
}) {
  ensureStyles();
  const classes = ["dc-avatar", shape === "circle" && "dc-avatar--circle", size !== "md" && `dc-avatar--${size}`, tone && "dc-avatar--toned", className].filter(Boolean).join(" ");
  const toneStyle = tone ? {
    "--tone": tone,
    ...style
  } : style;
  return /*#__PURE__*/React.createElement("span", _extends({
    className: classes,
    title: name,
    style: toneStyle
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name || ""
  }) : name ? initials(name) : /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon
  }));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/KindLabel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore KindLabel — the column-type annotation from the datatable header
   (Int / Float / Bool / Text). The source renders it as small muted text
   beside the column name; we keep that as the default and add a subtle chip
   variant with a faint per-kind tint for denser layouts. */

const CSS = `
.dc-kind{ --k: var(--text-muted); font-family:var(--font-mono); font-size:var(--text-2xs); font-weight:var(--weight-regular); line-height:1; color:var(--k); white-space:nowrap; }
.dc-kind--text-only{ color:var(--text-subtle); }
.dc-kind--chip{
  display:inline-flex; align-items:center; gap:.28rem; height:1.25rem; padding:0 .4rem;
  border:var(--border-width) solid color-mix(in srgb, var(--k) 28%, transparent);
  border-radius:var(--radius-xs);
  background:color-mix(in srgb, var(--k) 10%, var(--surface)); color:var(--k);
}
.dc-kind__tick{ width:.34rem; height:.34rem; border-radius:1px; background:var(--k); flex:none; }
.dc-kind--int{   --k:#0e7490; } /* cyan-700  — integer */
.dc-kind--float{ --k:#7c3aed; } /* violet-600 — float   */
.dc-kind--bool{  --k:var(--amber-700); }
.dc-kind--text{  --k:var(--text-muted); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "kindlabel");
  el.textContent = CSS;
  document.head.appendChild(el);
}
const KEY = {
  Int: "int",
  Float: "float",
  Bool: "bool",
  Text: "text"
};
function KindLabel({
  kind = "Text",
  variant = "text",
  className = "",
  ...rest
}) {
  ensureStyles();
  const k = KEY[kind] || "text";
  if (variant === "chip") {
    return /*#__PURE__*/React.createElement("span", _extends({
      className: `dc-kind dc-kind--chip dc-kind--${k} ${className}`.trim()
    }, rest), /*#__PURE__*/React.createElement("span", {
      className: "dc-kind__tick",
      "aria-hidden": "true"
    }), kind);
  }
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `dc-kind dc-kind--text-only ${className}`.trim()
  }, rest), kind);
}
Object.assign(__ds_scope, { KindLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/KindLabel.jsx", error: String((e && e.message) || e) }); }

// components/display/Stat.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Stat — a single metric/KPI: a big tabular number with a label and an
   optional caption or delta. The brand's "big number" pattern (the rbac panel's
   reach count, the dashboard KPI strip) made reusable. Flat by default; `bordered`
   boxes it as a tile. Delta arrows use the semantic success/danger hues. */

const CSS = `
.dc-stat{ display:flex; flex-direction:column; gap:2px; min-width:0; }
.dc-stat--bordered{ padding:var(--space-3) var(--space-4); border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); }
.dc-stat__label{ font-size:var(--text-xs); color:var(--text-muted); font-weight:var(--weight-medium); letter-spacing:var(--tracking-wide); text-transform:uppercase; white-space:nowrap; }
.dc-stat__value{ font-size:var(--text-3xl); font-weight:var(--weight-bold); line-height:1.05; color:var(--text); font-variant-numeric:var(--numeric-tabular); letter-spacing:var(--tracking-tight); }
.dc-stat--accent .dc-stat__value{ color:var(--accent); }
.dc-stat--success .dc-stat__value{ color:var(--success); }
.dc-stat--sm .dc-stat__value{ font-size:var(--text-2xl); }
.dc-stat__unit{ font-size:.5em; font-weight:var(--weight-medium); color:var(--text-muted); margin-left:.25em; letter-spacing:0; }
.dc-stat__foot{ display:flex; align-items:center; gap:var(--space-2); margin-top:1px; }
.dc-stat__caption{ font-size:var(--text-xs); color:var(--text-subtle); }
.dc-stat__delta{ display:inline-flex; align-items:center; gap:2px; font-size:var(--text-xs); font-weight:var(--weight-medium); font-variant-numeric:var(--numeric-tabular); }
.dc-stat__delta--up{ color:var(--success); }
.dc-stat__delta--down{ color:var(--danger); }
.dc-stat__delta--flat{ color:var(--text-muted); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "stat");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Stat({
  label,
  value,
  unit,
  caption,
  delta,
  tone = "default",
  size = "md",
  bordered = false,
  className = "",
  ...rest
}) {
  ensureStyles();
  const classes = ["dc-stat", tone !== "default" && `dc-stat--${tone}`, size !== "md" && `dc-stat--${size}`, bordered && "dc-stat--bordered", className].filter(Boolean).join(" ");
  const dir = delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return /*#__PURE__*/React.createElement("div", _extends({
    className: classes
  }, rest), label != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-stat__label"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "dc-stat__value"
  }, value, unit != null && /*#__PURE__*/React.createElement("span", {
    className: "dc-stat__unit"
  }, unit)), (caption != null || delta != null) && /*#__PURE__*/React.createElement("div", {
    className: "dc-stat__foot"
  }, delta != null && /*#__PURE__*/React.createElement("span", {
    className: `dc-stat__delta dc-stat__delta--${dir}`
  }, dir === "up" ? "▲" : dir === "down" ? "▼" : "—", " ", Math.abs(delta), typeof delta === "number" ? "%" : ""), caption != null && /*#__PURE__*/React.createElement("span", {
    className: "dc-stat__caption"
  }, caption)));
}
Object.assign(__ds_scope, { Stat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Stat.jsx", error: String((e && e.message) || e) }); }

// components/display/Toolbar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Toolbar — the source header bar: a sticky, hairline-bottomed row
   with a left group, a flexible spacer, and a right group. Used for the app
   header, table toolbars (row counts + actions), and dialog footers. */

const CSS = `
.dc-toolbar{
  display:flex; align-items:center; gap:var(--space-3);
  padding:var(--pad-section-y) var(--pad-section-x);
  background:var(--surface); color:var(--text);
}
.dc-toolbar--bordered{ border-bottom:var(--border-width) solid var(--border); }
.dc-toolbar--subtle{ background:var(--surface-subtle); }
.dc-toolbar--sticky{ position:sticky; top:0; z-index:var(--z-sticky); }
.dc-toolbar--dense{ padding:var(--space-2) var(--pad-section-x); gap:var(--space-2); }
.dc-toolbar__group{ display:flex; align-items:center; gap:var(--space-3); min-width:0; }
.dc-toolbar__group--right{ gap:var(--space-2); }
.dc-toolbar__spacer{ flex:1 1 auto; }
.dc-toolbar__title{ font-size:var(--text-lg); font-weight:var(--weight-semibold); margin:0; white-space:nowrap; }
.dc-toolbar__meta{ font-size:var(--text-sm); color:var(--text-muted); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "toolbar");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Toolbar({
  left,
  right,
  sticky = false,
  bordered = true,
  subtle = false,
  dense = false,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  const classes = ["dc-toolbar", bordered && "dc-toolbar--bordered", subtle && "dc-toolbar--subtle", sticky && "dc-toolbar--sticky", dense && "dc-toolbar--dense", className].filter(Boolean).join(" ");
  if (left != null || right != null) {
    return /*#__PURE__*/React.createElement("div", _extends({
      className: classes
    }, rest), /*#__PURE__*/React.createElement("div", {
      className: "dc-toolbar__group"
    }, left), /*#__PURE__*/React.createElement("div", {
      className: "dc-toolbar__spacer"
    }), /*#__PURE__*/React.createElement("div", {
      className: "dc-toolbar__group dc-toolbar__group--right"
    }, right));
  }
  return /*#__PURE__*/React.createElement("div", _extends({
    className: classes
  }, rest), children);
}
Object.assign(__ds_scope, { Toolbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Toolbar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Toast — a single transient notification. Flat card, hairline border,
   a tone-colored leading icon, and a quiet dismiss. The brand's voice: terse,
   often a verifiable result ("Exported 1,237 rows"). Tone picks the icon + hue;
   the host app manages stacking and auto-dismiss timing. */

const ICONS = {
  success: "check-circle-fill",
  danger: "x-circle-fill",
  warning: "exclamation-triangle-fill",
  info: "info-circle-fill"
};
const CSS = `
.dc-toast{
  --tone: var(--text-muted);
  display:flex; align-items:flex-start; gap:var(--space-3);
  width:min(24rem, 92vw); padding:var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  background:var(--surface-overlay); color:var(--text);
  border:1px solid var(--border); border-left:3px solid var(--tone);
  border-radius:var(--radius); box-shadow:var(--shadow-popover);
}
.dc-toast--success{ --tone:var(--success); }
.dc-toast--danger{ --tone:var(--danger); }
.dc-toast--warning{ --tone:var(--warning); }
.dc-toast--info{ --tone:var(--accent); }
.dc-toast__icon{ color:var(--tone); font-size:1rem; margin-top:.05rem; }
.dc-toast__body{ flex:1; min-width:0; }
.dc-toast__title{ font-size:var(--text-sm); font-weight:var(--weight-semibold); }
.dc-toast__desc{ font-size:var(--text-sm); color:var(--text-muted); margin-top:1px; }
.dc-toast__close{
  flex:none; background:none; border:0; color:var(--text-subtle); cursor:pointer;
  padding:2px; border-radius:var(--radius-xs); line-height:0; transition:var(--transition-control);
}
.dc-toast__close:hover{ color:var(--text); background:var(--surface-subtle); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "toast");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Toast({
  tone = "info",
  title,
  description,
  onClose,
  className = "",
  ...rest
}) {
  ensureStyles();
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `dc-toast dc-toast--${tone} ${className}`.trim(),
    role: "status"
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "dc-toast__icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ICONS[tone] || ICONS.info
  })), /*#__PURE__*/React.createElement("div", {
    className: "dc-toast__body"
  }, title != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-toast__title"
  }, title), description != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-toast__desc"
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    className: "dc-toast__close",
    "aria-label": "Dismiss",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x-lg",
    size: ".8rem"
  })));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Tooltip — a small hairline bubble on hover/focus, for the meaning of
   an icon-only control or a truncated identifier. CSS-driven (no positioning
   lib): wraps its child and reveals the bubble on hover or keyboard focus.
   Quiet and instant — depth via border + soft shadow, not a heavy popover. */

const CSS = `
.dc-tip{ position:relative; display:inline-flex; }
.dc-tip__bubble{
  position:absolute; z-index:var(--z-popover); pointer-events:none;
  white-space:nowrap; max-width:18rem;
  padding:var(--space-1) var(--space-2);
  font-size:var(--text-xs); line-height:var(--leading-tight);
  color:var(--text); background:var(--surface-overlay);
  border:1px solid var(--border); border-radius:var(--radius-sm);
  box-shadow:var(--shadow-popover);
  opacity:0; transform:translateY(2px); transition:opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.dc-tip:hover .dc-tip__bubble, .dc-tip:focus-within .dc-tip__bubble{ opacity:1; transform:translateY(0); }
.dc-tip__bubble--top{ bottom:calc(100% + 6px); left:50%; transform:translate(-50%, 2px); }
.dc-tip:hover .dc-tip__bubble--top, .dc-tip:focus-within .dc-tip__bubble--top{ transform:translate(-50%, 0); }
.dc-tip__bubble--bottom{ top:calc(100% + 6px); left:50%; transform:translate(-50%, -2px); }
.dc-tip:hover .dc-tip__bubble--bottom, .dc-tip:focus-within .dc-tip__bubble--bottom{ transform:translate(-50%, 0); }
.dc-tip__bubble--left{ right:calc(100% + 6px); top:50%; transform:translate(2px, -50%); }
.dc-tip:hover .dc-tip__bubble--left, .dc-tip:focus-within .dc-tip__bubble--left{ transform:translate(0, -50%); }
.dc-tip__bubble--right{ left:calc(100% + 6px); top:50%; transform:translate(-2px, -50%); }
.dc-tip:hover .dc-tip__bubble--right, .dc-tip:focus-within .dc-tip__bubble--right{ transform:translate(0, -50%); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "tooltip");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Tooltip({
  content,
  placement = "top",
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `dc-tip ${className}`.trim()
  }, rest), children, /*#__PURE__*/React.createElement("span", {
    className: `dc-tip__bubble dc-tip__bubble--${placement}`,
    role: "tooltip"
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Button — token-driven, self-contained (vanilla style injection,
   no CSS-in-JS lib). Mirrors the source UI's hairline-bordered control with a
   hover→accent border, and extends it with primary / ghost / danger variants. */

const CSS = `
.dc-btn{
  font: var(--font-body); font-weight: var(--weight-medium);
  display:inline-flex; align-items:center; justify-content:center; gap:var(--space-2);
  height:var(--control-h); padding:0 var(--pad-control-x);
  border:var(--border-width) solid var(--border); border-radius:var(--radius);
  background:var(--surface-subtle); color:var(--text);
  cursor:pointer; white-space:nowrap; user-select:none; line-height:1;
  transition:var(--transition-control);
}
.dc-btn:hover{ border-color:var(--accent); }
.dc-btn:active{ background:var(--surface-sunken); }
.dc-btn:focus-visible{ outline:var(--focus-ring); outline-offset:1px; }
.dc-btn[disabled],.dc-btn[aria-disabled="true"]{ opacity:.5; cursor:not-allowed; }
.dc-btn[disabled]:hover,.dc-btn[aria-disabled="true"]:hover{ border-color:var(--border); }

.dc-btn--primary{ background:var(--accent); border-color:var(--accent); color:var(--text-on-accent); }
.dc-btn--primary:hover{ background:var(--accent-hover); border-color:var(--accent-hover); }
.dc-btn--primary:active{ background:var(--accent-hover); }

.dc-btn--ghost{ background:transparent; border-color:transparent; }
.dc-btn--ghost:hover{ background:var(--surface-subtle); border-color:transparent; }
.dc-btn--ghost:active{ background:var(--surface-sunken); }

.dc-btn--danger{ background:var(--danger); border-color:var(--danger); color:#fff; }
.dc-btn--danger:hover{ filter:brightness(.94); border-color:var(--danger); }

.dc-btn--sm{ height:var(--control-h-sm); padding:0 var(--space-2); font-size:var(--text-sm); border-radius:var(--radius-sm); }
.dc-btn--lg{ height:var(--control-h-lg); padding:0 var(--space-4); }
.dc-btn--block{ width:100%; }
.dc-btn svg{ width:1em; height:1em; flex:none; }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "button");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Button({
  variant = "secondary",
  size = "md",
  block = false,
  leadingIcon = null,
  trailingIcon = null,
  disabled = false,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  const classes = ["dc-btn", variant !== "secondary" && `dc-btn--${variant}`, size !== "md" && `dc-btn--${size}`, block && "dc-btn--block", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    className: classes,
    disabled: disabled
  }, rest), leadingIcon, children != null && /*#__PURE__*/React.createElement("span", null, children), trailingIcon);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Checkbox — hairline box that fills with the accent when checked.
   Drives the column manager (show/hide) and the work tracker's close-checks. */

const CSS = `
.dc-check{ display:inline-flex; align-items:center; gap:var(--space-2); cursor:pointer; user-select:none; font:var(--font-body); color:var(--text); }
.dc-check input{ position:absolute; opacity:0; width:1px; height:1px; }
.dc-check__box{
  position:relative; flex:none; width:1.05rem; height:1.05rem;
  border:var(--border-width) solid var(--border-strong); border-radius:var(--radius-xs);
  background:var(--surface); transition:var(--transition-control);
}
.dc-check__box::after{
  content:""; position:absolute; left:0.3rem; top:0.13rem;
  width:0.28rem; height:0.55rem; border:solid #fff; border-width:0 2px 2px 0;
  transform:rotate(45deg) scale(0); transform-origin:center; transition:transform var(--dur-fast) var(--ease-standard);
}
.dc-check:hover .dc-check__box{ border-color:var(--accent); }
.dc-check input:checked + .dc-check__box{ background:var(--accent); border-color:var(--accent); }
.dc-check input:checked + .dc-check__box::after{ transform:rotate(45deg) scale(1); }
.dc-check input:indeterminate + .dc-check__box{ background:var(--accent); border-color:var(--accent); }
.dc-check input:indeterminate + .dc-check__box::after{
  transform:none; left:0.2rem; top:0.45rem; width:0.5rem; height:0; border-width:0 0 2px 0; border-color:#fff;
}
.dc-check input:focus-visible + .dc-check__box{ outline:var(--focus-ring); outline-offset:2px; }
.dc-check--disabled{ opacity:.5; cursor:not-allowed; }
.dc-check__label{ font-size:var(--text-md); }
.dc-check__label--mono{ font-family:var(--font-mono); font-size:var(--text-sm); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "checkbox");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Checkbox({
  checked,
  defaultChecked,
  indeterminate = false,
  onChange,
  label,
  mono = false,
  disabled = false,
  className = "",
  ...rest
}) {
  ensureStyles();
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return /*#__PURE__*/React.createElement("label", {
    className: `dc-check${disabled ? " dc-check--disabled" : ""} ${className}`.trim()
  }, /*#__PURE__*/React.createElement("input", _extends({
    ref: ref,
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "dc-check__box",
    "aria-hidden": "true"
  }), label != null && /*#__PURE__*/React.createElement("span", {
    className: `dc-check__label${mono ? " dc-check__label--mono" : ""}`
  }, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore IconButton — square, icon-only control for toolbars and table
   headers (sort toggles, close, overflow). Same hairline language as Button.
   Icon content is a Unicode glyph or inline SVG passed as children. */

const CSS = `
.dc-iconbtn{
  display:inline-flex; align-items:center; justify-content:center;
  width:var(--control-h); height:var(--control-h); padding:0;
  border:var(--border-width) solid transparent; border-radius:var(--radius);
  background:transparent; color:var(--text-muted);
  cursor:pointer; line-height:1; font-size:var(--text-md);
  transition:var(--transition-control);
}
.dc-iconbtn:hover{ background:var(--surface-subtle); color:var(--text); }
.dc-iconbtn:active{ background:var(--surface-sunken); }
.dc-iconbtn:focus-visible{ outline:var(--focus-ring); outline-offset:1px; }
.dc-iconbtn[disabled]{ opacity:.45; cursor:not-allowed; }
.dc-iconbtn[disabled]:hover{ background:transparent; color:var(--text-muted); }
.dc-iconbtn[aria-pressed="true"],.dc-iconbtn.is-active{ color:var(--accent); background:var(--accent-tint); }
.dc-iconbtn--bordered{ border-color:var(--border); }
.dc-iconbtn--bordered:hover{ border-color:var(--accent); background:transparent; color:var(--text); }
.dc-iconbtn--sm{ width:var(--control-h-sm); height:var(--control-h-sm); font-size:var(--text-sm); border-radius:var(--radius-sm); }
.dc-iconbtn--lg{ width:var(--control-h-lg); height:var(--control-h-lg); }
.dc-iconbtn svg{ width:1.05em; height:1.05em; }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "iconbutton");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function IconButton({
  label,
  size = "md",
  bordered = false,
  active = false,
  disabled = false,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  const classes = ["dc-iconbtn", bordered && "dc-iconbtn--bordered", active && "is-active", size !== "md" && `dc-iconbtn--${size}`, className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    className: classes,
    "aria-label": label,
    title: rest.title ?? label,
    disabled: disabled
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Dialog — a modal panel over a dimmed scrim. Flat, hairline-bordered,
   soft dialog shadow (one of the few places the brand floats). Closes on scrim
   click and Escape. Header (title + close), body, and an optional footer action
   row. Renders nothing when `open` is false. */

const CSS = `
.dc-dialog__scrim{
  position:fixed; inset:0; z-index:var(--z-dialog);
  background:color-mix(in srgb, var(--neutral-950) 45%, transparent);
  display:flex; align-items:center; justify-content:center; padding:var(--space-6);
  animation:dc-dialog-fade var(--dur) var(--ease-out);
}
.dc-dialog{
  width:100%; max-width:32rem; max-height:calc(100vh - 4rem);
  display:flex; flex-direction:column;
  background:var(--surface-overlay); color:var(--text);
  border:1px solid var(--border); border-radius:var(--radius-lg);
  box-shadow:var(--shadow-dialog); overflow:hidden;
  animation:dc-dialog-rise var(--dur) var(--ease-out);
}
.dc-dialog--sm{ max-width:24rem; } .dc-dialog--lg{ max-width:44rem; }
.dc-dialog__head{
  display:flex; align-items:center; gap:var(--space-3);
  padding:var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border-bottom:1px solid var(--border);
}
.dc-dialog__title{ font-size:var(--text-lg); font-weight:var(--weight-semibold); margin:0; }
.dc-dialog__close{ margin-left:auto; }
.dc-dialog__body{ padding:var(--space-4); overflow:auto; }
.dc-dialog__foot{
  display:flex; align-items:center; justify-content:flex-end; gap:var(--space-2);
  padding:var(--space-3) var(--space-4); border-top:1px solid var(--border);
  background:var(--surface-subtle);
}
@keyframes dc-dialog-fade{ from{ opacity:0 } }
@keyframes dc-dialog-rise{ from{ opacity:0; transform:translateY(8px) } }
@media (prefers-reduced-motion: reduce){
  .dc-dialog__scrim,.dc-dialog{ animation:none; }
}
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "dialog");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Dialog({
  open,
  onClose,
  title,
  footer,
  size = "md",
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  React.useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === "Escape" && onClose && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "dc-dialog__scrim",
    onMouseDown: e => e.target === e.currentTarget && onClose && onClose()
  }, /*#__PURE__*/React.createElement("div", _extends({
    className: ["dc-dialog", size !== "md" && `dc-dialog--${size}`, className].filter(Boolean).join(" "),
    role: "dialog",
    "aria-modal": "true",
    "aria-label": typeof title === "string" ? title : undefined
  }, rest), (title != null || onClose) && /*#__PURE__*/React.createElement("div", {
    className: "dc-dialog__head"
  }, title != null && /*#__PURE__*/React.createElement("h2", {
    className: "dc-dialog__title"
  }, title), onClose && /*#__PURE__*/React.createElement("span", {
    className: "dc-dialog__close"
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    label: "Close",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x-lg"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "dc-dialog__body"
  }, children), footer != null && /*#__PURE__*/React.createElement("div", {
    className: "dc-dialog__foot"
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Input — text field matching the source filter control: hairline
   border, compact padding, a 2px inset accent outline on focus. Supports an
   optional leading adornment (e.g. a search glyph), sizes, and an invalid state. */

const CSS = `
.dc-field{ display:inline-flex; flex-direction:column; gap:var(--space-1); }
.dc-field--block{ display:flex; width:100%; }
.dc-field__label{ font-size:var(--text-sm); font-weight:var(--weight-medium); color:var(--text); }
.dc-field__hint{ font-size:var(--text-xs); color:var(--text-muted); }
.dc-field__hint--error{ color:var(--danger); }

.dc-input{
  display:flex; align-items:center; gap:var(--space-2);
  height:var(--control-h); padding:0 var(--pad-control-x);
  border:var(--border-width) solid var(--border); border-radius:var(--radius-sm);
  background:var(--surface); color:var(--text);
  transition:var(--transition-control);
}
.dc-input:hover{ border-color:var(--border-strong); }
.dc-input:focus-within{ outline:var(--focus-ring); outline-offset:var(--focus-offset); border-color:var(--accent); }
.dc-input--invalid{ border-color:var(--danger); }
.dc-input--invalid:focus-within{ outline-color:var(--danger); border-color:var(--danger); }
.dc-input--sm{ height:var(--control-h-sm); padding:0 var(--space-2); }
.dc-input--disabled{ opacity:.55; background:var(--surface-subtle); cursor:not-allowed; }

.dc-input__adorn{ color:var(--text-subtle); font-size:var(--text-sm); display:inline-flex; flex:none; }
.dc-input input{
  flex:1; min-width:0; border:0; outline:0; background:transparent;
  font:var(--font-body); color:inherit;
}
.dc-input input::placeholder{ color:var(--text-subtle); }
.dc-input--block{ width:100%; }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "input");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Input({
  label,
  hint,
  error,
  size = "md",
  block = false,
  leadingIcon = null,
  trailingIcon = null,
  disabled = false,
  id,
  className = "",
  ...rest
}) {
  ensureStyles();
  const fieldId = id || (label ? `dc-${Math.random().toString(36).slice(2, 8)}` : undefined);
  const boxClasses = ["dc-input", size !== "md" && `dc-input--${size}`, block && "dc-input--block", error && "dc-input--invalid", disabled && "dc-input--disabled", className].filter(Boolean).join(" ");
  const box = /*#__PURE__*/React.createElement("div", {
    className: boxClasses
  }, leadingIcon && /*#__PURE__*/React.createElement("span", {
    className: "dc-input__adorn"
  }, leadingIcon), /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    disabled: disabled,
    "aria-invalid": !!error
  }, rest)), trailingIcon && /*#__PURE__*/React.createElement("span", {
    className: "dc-input__adorn"
  }, trailingIcon));
  if (!label && !hint && !error) return box;
  return /*#__PURE__*/React.createElement("div", {
    className: `dc-field${block ? " dc-field--block" : ""}`
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "dc-field__label",
    htmlFor: fieldId
  }, label), box, (error || hint) && /*#__PURE__*/React.createElement("span", {
    className: `dc-field__hint${error ? " dc-field__hint--error" : ""}`
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Select — a native <select> in the brand's hairline shell with a
   Unicode chevron. Used for column-kind filter ops, status pickers, page size. */

const CSS = `
.dc-select{ display:inline-flex; flex-direction:column; gap:var(--space-1); }
.dc-select--block{ display:flex; width:100%; }
.dc-select__label{ font-size:var(--text-sm); font-weight:var(--weight-medium); color:var(--text); }
.dc-select__shell{ position:relative; display:inline-flex; align-items:center; }
.dc-select--block .dc-select__shell{ display:flex; width:100%; }
.dc-select select{
  appearance:none; -webkit-appearance:none;
  font:var(--font-body); color:var(--text);
  height:var(--control-h); width:100%;
  padding:0 calc(var(--space-6)) 0 var(--pad-control-x);
  border:var(--border-width) solid var(--border); border-radius:var(--radius-sm);
  background:var(--surface); cursor:pointer;
  transition:var(--transition-control);
}
.dc-select select:hover{ border-color:var(--border-strong); }
.dc-select select:focus-visible{ outline:var(--focus-ring); outline-offset:var(--focus-offset); border-color:var(--accent); }
.dc-select select:disabled{ opacity:.55; background:var(--surface-subtle); cursor:not-allowed; }
.dc-select--sm select{ height:var(--control-h-sm); font-size:var(--text-sm); padding-right:var(--space-5); }
.dc-select__chevron{
  position:absolute; right:var(--space-2); pointer-events:none;
  color:var(--text-subtle); font-size:.7em; line-height:1;
}
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "select");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Select({
  label,
  options = [],
  size = "md",
  block = false,
  id,
  className = "",
  children,
  ...rest
}) {
  ensureStyles();
  const fieldId = id || (label ? `dc-${Math.random().toString(36).slice(2, 8)}` : undefined);
  const classes = ["dc-select", size !== "md" && `dc-select--${size}`, block && "dc-select--block", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: classes
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "dc-select__label",
    htmlFor: fieldId
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "dc-select__shell"
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: fieldId
  }, rest), children || options.map(o => {
    const opt = typeof o === "string" ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })), /*#__PURE__*/React.createElement("span", {
    className: "dc-select__chevron",
    "aria-hidden": "true"
  }, "\u25BC")));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Datacore Tabs — calm view switcher. Underline variant (default) is the quiet
   in-page switch (list ⇄ board); `segmented` is a bordered pill group for
   compact toolbars. Controlled via `value`/`onChange`, or uncontrolled with
   `defaultValue`. Each tab is { id, label, icon?, count? }. */

const CSS = `
.dc-tabs{ display:inline-flex; }
.dc-tabs--block{ display:flex; }
.dc-tabs__tab{
  display:inline-flex; align-items:center; gap:var(--space-2);
  font:var(--font-body); font-weight:var(--weight-medium); color:var(--text-muted);
  background:none; border:0; cursor:pointer; white-space:nowrap;
  transition:var(--transition-control);
}
.dc-tabs__count{ font-size:var(--text-2xs); color:var(--text-subtle); font-variant-numeric:tabular-nums; }

/* underline */
.dc-tabs--underline{ gap:var(--space-4); border-bottom:1px solid var(--border); }
.dc-tabs--underline .dc-tabs__tab{
  padding:var(--space-2) 2px; margin-bottom:-1px;
  border-bottom:2px solid transparent;
}
.dc-tabs--underline .dc-tabs__tab:hover{ color:var(--text); }
.dc-tabs--underline .dc-tabs__tab[aria-selected="true"]{ color:var(--accent); border-bottom-color:var(--accent); }
.dc-tabs--underline .dc-tabs__tab[aria-selected="true"] .dc-tabs__count{ color:var(--accent); }

/* segmented */
.dc-tabs--segmented{ gap:0; padding:3px; background:var(--surface-subtle); border:1px solid var(--border); border-radius:var(--radius); }
.dc-tabs--segmented .dc-tabs__tab{ padding:var(--space-1) var(--pad-control-x); border-radius:var(--radius-sm); height:calc(var(--control-h) - 6px); }
.dc-tabs--segmented .dc-tabs__tab:hover{ color:var(--text); }
.dc-tabs--segmented .dc-tabs__tab[aria-selected="true"]{ color:var(--text); background:var(--surface); box-shadow:var(--shadow-popover); }

.dc-tabs__tab:focus-visible{ outline:var(--focus-ring); outline-offset:2px; border-radius:var(--radius-xs); }
`;
let injected = false;
function ensureStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "tabs");
  el.textContent = CSS;
  document.head.appendChild(el);
}
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  variant = "underline",
  block = false,
  className = "",
  ...rest
}) {
  ensureStyles();
  const [internal, setInternal] = React.useState(defaultValue != null ? defaultValue : tabs[0] && tabs[0].id);
  const active = value != null ? value : internal;
  function pick(id) {
    if (value == null) setInternal(id);
    onChange && onChange(id);
  }
  const classes = ["dc-tabs", `dc-tabs--${variant}`, block && "dc-tabs--block", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: classes,
    role: "tablist"
  }, rest), tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    role: "tab",
    type: "button",
    "aria-selected": active === t.id,
    className: "dc-tabs__tab",
    onClick: () => pick(t.id),
    style: block ? {
      flex: 1,
      justifyContent: "center"
    } : undefined
  }, t.icon, t.label, t.count != null && /*#__PURE__*/React.createElement("span", {
    className: "dc-tabs__count"
  }, t.count))));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/build-engine/BuildEngineApp.jsx
try { (() => {
/* BuildEngineApp — the work tracker. Two views: a master/detail List and a
   kanban Board (segmented Tabs). Mutations go through the pure engine: set_status
   calls evaluate() and only writes on Allow, appending to the append-only
   activity log; an illegal move surfaces the reason inline AND as a toast.
   create_case (via the dialog) forces the initial status. Composes Datacore
   primitives. */

const WE = window.DatacoreDesignSystem_a460c7;
const ENG = window.DatacoreBuildEngine;
const {
  Toolbar: WToolbar,
  Button: WButton,
  EmptyState: WEmpty,
  Tabs: WTabs,
  Toast: WToast,
  Icon: WIcon
} = WE;
const {
  WORKFLOW,
  evaluate,
  STATE_META: WState,
  CASES
} = ENG;
const {
  useState,
  useMemo
} = React;
const FILTERS = ["all", "backlog", "in_progress", "in_review", "done"];
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function newId() {
  let s = "CAS_";
  for (let i = 0; i < 32; i++) s += "0123456789ABCDEF"[Math.floor(Math.random() * 16)];
  return s;
}
function BuildEngineApp() {
  const [cases, setCases] = useState(() => JSON.parse(JSON.stringify(CASES)));
  const [selectedId, setSelectedId] = useState(CASES[0].id);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("board");
  const [reject, setReject] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const selected = cases.find(c => c.id === selectedId) || null;
  const visible = useMemo(() => filter === "all" ? cases : cases.filter(c => c.status === filter), [cases, filter]);
  function pushToast(t) {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, {
      id,
      ...t
    }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 4000);
  }
  function dismiss(id) {
    setToasts(ts => ts.filter(x => x.id !== id));
  }
  function select(id) {
    setSelectedId(id);
    setReject(null);
  }
  function openFromBoard(id) {
    select(id);
    setView("list");
  }
  function mutate(id, fn) {
    setCases(cs => cs.map(c => c.id === id ? fn({
      ...c
    }) : c));
  }
  function onSetStatus(to) {
    if (!selected) return;
    const from = selected.status;
    const res = evaluate(WORKFLOW, from, to, selected.closeChecks);
    if (res.noop) return;
    if (!res.allow) {
      setReject(res);
      pushToast({
        tone: "danger",
        title: res.kind,
        description: res.missing && res.missing.length ? "missing: " + res.missing.join(", ") : `${from} → ${to} · 422`
      });
      return;
    }
    setReject(null);
    mutate(selected.id, c => {
      c.status = to;
      c.activity = [...c.activity, {
        text: `case_status ${from} → ${to}`,
        at: nowHHMM()
      }];
      return c;
    });
    pushToast({
      tone: "success",
      title: `Moved to ${WState[to].label}`,
      description: `case_status ${from} → ${to}`
    });
  }
  function onToggleCheck(name) {
    if (!selected) return;
    let nextVal = null;
    mutate(selected.id, c => {
      c.closeChecks = c.closeChecks.map(ck => {
        if (ck.name !== name) return ck;
        nextVal = !ck.passed;
        return {
          ...ck,
          passed: nextVal
        };
      });
      c.activity = [...c.activity, {
        text: `case_close_check ${name} = ${nextVal}`,
        at: nowHHMM()
      }];
      return c;
    });
    setReject(r => r && r.kind === "close_preconditions_unmet" ? null : r);
  }
  function createCase(form) {
    const c = {
      id: newId(),
      title: form.title,
      workflow: "feature",
      status: WORKFLOW.initial,
      // create_case forces the initial status
      priority: form.priority,
      assignee: form.assignee,
      closeChecks: [{
        name: "docs-reconciled",
        passed: false,
        note: ""
      }, {
        name: "tests-green",
        passed: false,
        note: ""
      }, {
        name: "reviewer-approved",
        passed: false,
        note: ""
      }],
      comments: [],
      activity: [{
        text: `case created at ${WORKFLOW.initial}`,
        at: nowHHMM()
      }]
    };
    setCases(cs => [c, ...cs]);
    setDialogOpen(false);
    select(c.id);
    setView("list");
    pushToast({
      tone: "info",
      title: "Case created",
      description: `opened at ${WORKFLOW.initial}`
    });
  }
  const counts = FILTERS.reduce((m, f) => {
    m[f] = f === "all" ? cases.length : cases.filter(c => c.status === f).length;
    return m;
  }, {});
  return /*#__PURE__*/React.createElement("div", {
    className: "we-app"
  }, /*#__PURE__*/React.createElement(WToolbar, {
    sticky: true,
    left: /*#__PURE__*/React.createElement("div", {
      className: "we-brand"
    }, /*#__PURE__*/React.createElement("span", {
      className: "we-logo",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("h1", {
      className: "we-title"
    }, "build-engine"), /*#__PURE__*/React.createElement("span", {
      className: "we-meta"
    }, "workflow-as-data \xB7 the engine's own work tracker")),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(WTabs, {
      variant: "segmented",
      value: view,
      onChange: setView,
      tabs: [{
        id: "board",
        label: "Board",
        icon: /*#__PURE__*/React.createElement(WIcon, {
          name: "kanban"
        })
      }, {
        id: "list",
        label: "List",
        icon: /*#__PURE__*/React.createElement(WIcon, {
          name: "list-ul"
        })
      }]
    }), /*#__PURE__*/React.createElement(WButton, {
      variant: "primary",
      leadingIcon: /*#__PURE__*/React.createElement(WIcon, {
        name: "plus-lg"
      }),
      onClick: () => setDialogOpen(true)
    }, "New case"))
  }), view === "board" ? /*#__PURE__*/React.createElement("div", {
    className: "we-boardhost"
  }, /*#__PURE__*/React.createElement(CaseBoard, {
    states: WORKFLOW.states,
    cases: cases,
    selectedId: selectedId,
    onSelect: openFromBoard
  })) : /*#__PURE__*/React.createElement("div", {
    className: "we-body"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "we-rail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "we-rail__head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "we-filters"
  }, FILTERS.map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    className: "we-filter" + (filter === f ? " is-active" : ""),
    onClick: () => setFilter(f)
  }, f === "all" ? "all" : WState[f].label, /*#__PURE__*/React.createElement("span", {
    className: "we-filter__n"
  }, counts[f]))))), /*#__PURE__*/React.createElement(CaseList, {
    cases: visible,
    selectedId: selectedId,
    onSelect: select
  })), /*#__PURE__*/React.createElement("main", {
    className: "we-main"
  }, selected ? /*#__PURE__*/React.createElement(CaseDetail, {
    c: selected,
    reject: reject,
    onSetStatus: onSetStatus,
    onToggleCheck: onToggleCheck
  }) : /*#__PURE__*/React.createElement(WEmpty, {
    glyph: /*#__PURE__*/React.createElement(WIcon, {
      name: "inbox",
      size: "1.9rem"
    }),
    lead: "Select a case",
    description: "Pick a case from the rail, or open a new one \u2014 it starts at backlog.",
    action: /*#__PURE__*/React.createElement(WButton, {
      variant: "primary",
      leadingIcon: /*#__PURE__*/React.createElement(WIcon, {
        name: "plus-lg"
      }),
      onClick: () => setDialogOpen(true)
    }, "New case")
  }))), /*#__PURE__*/React.createElement(NewCaseDialog, {
    open: dialogOpen,
    onClose: () => setDialogOpen(false),
    onCreate: createCase
  }), /*#__PURE__*/React.createElement("div", {
    className: "we-toasts"
  }, toasts.map(t => /*#__PURE__*/React.createElement(WToast, {
    key: t.id,
    tone: t.tone,
    title: t.title,
    description: t.description,
    onClose: () => dismiss(t.id)
  }))));
}
Object.assign(window, {
  BuildEngineApp
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/build-engine/BuildEngineApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/build-engine/CaseBoard.jsx
try { (() => {
/* CaseBoard — the kanban overview: one column per workflow state, cases as
   cards. The column order IS the workflow order (left→right = backlog→done), so
   the board reads as the pipeline. Click a card to open its detail. Composes
   Avatar + Badge + Code + Icon. */

const {
  Badge: BoardBadge,
  Code: BoardCode,
  Avatar: BoardAvatar,
  Icon: BoardIcon
} = window.DatacoreDesignSystem_a460c7;
const {
  STATE_META: BoardState,
  PRIORITY_META: BoardPrio
} = window.DatacoreBuildEngine;
function CaseBoard({
  states,
  cases,
  selectedId,
  onSelect
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "we-board"
  }, states.map(st => {
    const col = cases.filter(c => c.status === st);
    const meta = BoardState[st];
    return /*#__PURE__*/React.createElement("section", {
      className: "we-col",
      key: st
    }, /*#__PURE__*/React.createElement("header", {
      className: "we-col__head"
    }, /*#__PURE__*/React.createElement("span", {
      className: "we-col__dot",
      style: {
        background: `var(--status-${meta.tone})`
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "we-col__title"
    }, meta.label), /*#__PURE__*/React.createElement("span", {
      className: "we-col__n"
    }, col.length)), /*#__PURE__*/React.createElement("div", {
      className: "we-col__cards"
    }, col.map(c => {
      const done = c.closeChecks.filter(x => x.passed).length;
      const gateClear = done === c.closeChecks.length;
      return /*#__PURE__*/React.createElement("button", {
        key: c.id,
        className: "we-bcard" + (c.id === selectedId ? " is-selected" : ""),
        onClick: () => onSelect(c.id)
      }, /*#__PURE__*/React.createElement("div", {
        className: "we-bcard__title"
      }, c.title), /*#__PURE__*/React.createElement("div", {
        className: "we-bcard__id"
      }, /*#__PURE__*/React.createElement(BoardCode, {
        truncate: true,
        tone: "muted"
      }, c.id)), /*#__PURE__*/React.createElement("div", {
        className: "we-bcard__foot"
      }, /*#__PURE__*/React.createElement(BoardAvatar, {
        size: "sm",
        name: c.assignee === "unassigned" ? "" : c.assignee,
        icon: "person",
        tone: "var(--text-muted)"
      }), /*#__PURE__*/React.createElement("span", {
        className: "we-bcard__assignee"
      }, c.assignee), /*#__PURE__*/React.createElement("span", {
        className: "we-bcard__spacer"
      }), /*#__PURE__*/React.createElement("span", {
        className: "we-bcard__checks" + (gateClear ? " is-clear" : ""),
        title: `${done}/${c.closeChecks.length} close-checks passed`
      }, /*#__PURE__*/React.createElement(BoardIcon, {
        name: gateClear ? "check2-square" : "square"
      }), " ", done, "/", c.closeChecks.length), c.priority !== "normal" && /*#__PURE__*/React.createElement(BoardBadge, {
        tone: BoardPrio[c.priority].tone,
        square: true
      }, c.priority)));
    }), col.length === 0 && /*#__PURE__*/React.createElement("div", {
      className: "we-col__empty"
    }, "No cases")));
  }));
}
Object.assign(window, {
  CaseBoard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/build-engine/CaseBoard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/build-engine/CaseDetail.jsx
try { (() => {
/* CaseDetail — the right pane: identity, the workflow stepper + the transitions
   the engine currently allows, the close-check gate, the comment thread, and the
   append-only activity log. Trying an illegal move surfaces the engine's reason. */

const DS = window.DatacoreDesignSystem_a460c7;
const BE = window.DatacoreBuildEngine;
const {
  Badge: DBadge,
  Button: DButton,
  Checkbox: DCheck,
  Card: DCard,
  Code: DCode,
  Avatar: DAvatar,
  Icon: DIcon
} = DS;
const {
  STATE_META: DState,
  PRIORITY_META: DPrio,
  ROLE_META: DRole,
  WORKFLOW: DWF
} = BE;
function CaseDetail({
  c,
  reject,
  onSetStatus,
  onToggleCheck
}) {
  const st = DState[c.status];
  const passed = c.closeChecks.filter(x => x.passed).length;
  const total = c.closeChecks.length;
  const gateClear = passed === total;
  const allowed = DWF.transitions[c.status] || [];
  const terminal = DWF.states[DWF.states.length - 1];
  const missing = reject && reject.missing || [];
  return /*#__PURE__*/React.createElement("div", {
    className: "we-detail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "we-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "we-head__top"
  }, /*#__PURE__*/React.createElement(DBadge, {
    tone: st.tone,
    dot: true
  }, st.label), /*#__PURE__*/React.createElement(DBadge, {
    tone: DPrio[c.priority].tone,
    square: true
  }, c.priority), /*#__PURE__*/React.createElement("span", {
    className: "we-head__id"
  }, /*#__PURE__*/React.createElement(DCode, {
    truncate: true
  }, c.id))), /*#__PURE__*/React.createElement("h2", {
    className: "we-head__title"
  }, c.title), /*#__PURE__*/React.createElement("div", {
    className: "we-head__meta"
  }, "workflow ", /*#__PURE__*/React.createElement(DCode, {
    tone: "accent"
  }, c.workflow), /*#__PURE__*/React.createElement("span", {
    className: "we-sep"
  }, "\xB7"), " assignee ", /*#__PURE__*/React.createElement("b", null, c.assignee), /*#__PURE__*/React.createElement("span", {
    className: "we-sep"
  }, "\xB7"), " ", passed, "/", total, " close-checks passed")), /*#__PURE__*/React.createElement(DCard, null, /*#__PURE__*/React.createElement(WorkflowStepper, {
    states: DWF.states,
    current: c.status,
    gateClear: gateClear
  }), /*#__PURE__*/React.createElement("div", {
    className: "we-actions"
  }, /*#__PURE__*/React.createElement("span", {
    className: "we-actions__label"
  }, "set_status \u2192"), allowed.map(to => {
    const isDone = to === terminal;
    const isBack = DWF.states.indexOf(to) < DWF.states.indexOf(c.status);
    return /*#__PURE__*/React.createElement(DButton, {
      key: to,
      size: "sm",
      variant: isDone ? "primary" : isBack ? "ghost" : "secondary",
      leadingIcon: /*#__PURE__*/React.createElement(DIcon, {
        name: isDone ? "check-lg" : isBack ? "arrow-counterclockwise" : "arrow-right"
      }),
      onClick: () => onSetStatus(to)
    }, DState[to].label);
  }), !allowed.length && /*#__PURE__*/React.createElement("span", {
    className: "we-actions__none"
  }, "terminal \u2014 reopen via in\xA0review")), reject && /*#__PURE__*/React.createElement("div", {
    className: "we-reject"
  }, /*#__PURE__*/React.createElement(DIcon, {
    name: "x-octagon-fill",
    style: {
      color: "var(--danger)"
    }
  }), /*#__PURE__*/React.createElement(DBadge, {
    tone: "danger",
    square: true
  }, "422"), /*#__PURE__*/React.createElement("code", {
    className: "we-reject__reason"
  }, reject.reason), missing.length > 0 && /*#__PURE__*/React.createElement("span", {
    className: "we-reject__missing"
  }, "missing: ", missing.map(m => /*#__PURE__*/React.createElement(DCode, {
    key: m,
    tone: "muted"
  }, m))))), /*#__PURE__*/React.createElement(DCard, {
    title: "Close-checks",
    subtitle: gateClear ? "gate clear — done is reachable" : `${total - passed} unmet — done is gated`,
    actions: /*#__PURE__*/React.createElement(DBadge, {
      tone: gateClear ? "success" : "warning",
      dot: true
    }, gateClear ? "clear" : "gated")
  }, /*#__PURE__*/React.createElement("ul", {
    className: "we-checks"
  }, c.closeChecks.map(ck => /*#__PURE__*/React.createElement("li", {
    key: ck.name,
    className: "we-check" + (missing.includes(ck.name) ? " is-missing" : "")
  }, /*#__PURE__*/React.createElement(DCheck, {
    mono: true,
    checked: ck.passed,
    label: ck.name,
    onChange: () => onToggleCheck(ck.name)
  }), ck.note && /*#__PURE__*/React.createElement("span", {
    className: "we-check__note"
  }, ck.note))))), /*#__PURE__*/React.createElement("div", {
    className: "we-cols"
  }, /*#__PURE__*/React.createElement(DCard, {
    title: "Thread",
    subtitle: `${c.comments.length} comments`
  }, /*#__PURE__*/React.createElement("ul", {
    className: "we-thread"
  }, c.comments.map((m, i) => {
    const r = DRole[m.role] || {};
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      className: "we-msg"
    }, /*#__PURE__*/React.createElement(DAvatar, {
      icon: r.bi,
      tone: r.hue
    }), /*#__PURE__*/React.createElement("div", {
      className: "we-msg__body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "we-msg__head"
    }, /*#__PURE__*/React.createElement("b", null, m.role), /*#__PURE__*/React.createElement("span", {
      className: "we-msg__author"
    }, m.author), /*#__PURE__*/React.createElement("span", {
      className: "we-msg__at"
    }, m.at)), /*#__PURE__*/React.createElement("p", {
      className: "we-msg__text"
    }, m.body)));
  }))), /*#__PURE__*/React.createElement(DCard, {
    title: "Activity",
    subtitle: "append-only"
  }, /*#__PURE__*/React.createElement("ul", {
    className: "we-activity"
  }, c.activity.map((a, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    className: "we-event"
  }, /*#__PURE__*/React.createElement("span", {
    className: "we-event__rail"
  }), /*#__PURE__*/React.createElement("code", {
    className: "we-event__text"
  }, a.text), /*#__PURE__*/React.createElement("span", {
    className: "we-event__at"
  }, a.at)))))));
}
Object.assign(window, {
  CaseDetail
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/build-engine/CaseDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/build-engine/CaseList.jsx
try { (() => {
/* CaseList — the left rail. One row per case: a status dot, the title, the
   short entity id, the assignee, and a priority badge for anything not normal. */

const {
  STATE_META: ListState,
  PRIORITY_META: ListPrio,
  Badge: ListBadge,
  Code: ListCode
} = Object.assign({}, window.DatacoreBuildEngine, window.DatacoreDesignSystem_a460c7);
function CaseList({
  cases,
  selectedId,
  onSelect
}) {
  if (!cases.length) {
    return /*#__PURE__*/React.createElement("div", {
      className: "we-list__empty"
    }, "No cases match this filter.");
  }
  return /*#__PURE__*/React.createElement("ul", {
    className: "we-list"
  }, cases.map(c => {
    const st = ListState[c.status];
    const done = c.closeChecks.filter(x => x.passed).length;
    return /*#__PURE__*/React.createElement("li", {
      key: c.id
    }, /*#__PURE__*/React.createElement("button", {
      className: "we-row" + (c.id === selectedId ? " is-selected" : ""),
      onClick: () => onSelect(c.id)
    }, /*#__PURE__*/React.createElement("span", {
      className: "we-row__dot",
      style: {
        background: `var(--status-${st.tone})`
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "we-row__main"
    }, /*#__PURE__*/React.createElement("span", {
      className: "we-row__title"
    }, c.title), /*#__PURE__*/React.createElement("span", {
      className: "we-row__meta"
    }, /*#__PURE__*/React.createElement(ListCode, {
      truncate: true,
      tone: "muted"
    }, c.id), /*#__PURE__*/React.createElement("span", {
      className: "we-row__sep"
    }, "\xB7"), /*#__PURE__*/React.createElement("span", null, c.assignee), /*#__PURE__*/React.createElement("span", {
      className: "we-row__sep"
    }, "\xB7"), /*#__PURE__*/React.createElement("span", {
      className: "we-row__checks"
    }, done, "/", c.closeChecks.length, " checks"))), c.priority !== "normal" && /*#__PURE__*/React.createElement(ListBadge, {
      tone: ListPrio[c.priority].tone,
      square: true
    }, c.priority)));
  }));
}
Object.assign(window, {
  CaseList
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/build-engine/CaseList.jsx", error: String((e && e.message) || e) }); }

// ui_kits/build-engine/NewCaseDialog.jsx
try { (() => {
/* NewCaseDialog — the create-case flow. Collects title, priority and assignee,
   then hands a draft to the app, which forces the initial status (create_case
   semantics). Composes Dialog + Input + Select + Button + Code. */

const {
  Dialog: NcDialog,
  Input: NcInput,
  Select: NcSelect,
  Button: NcButton,
  Code: NcCode
} = window.DatacoreDesignSystem_a460c7;
const {
  WORKFLOW: NcWF
} = window.DatacoreBuildEngine;
function NewCaseDialog({
  open,
  onClose,
  onCreate
}) {
  const [title, setTitle] = React.useState("");
  const [priority, setPriority] = React.useState("normal");
  const [assignee, setAssignee] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setPriority("normal");
      setAssignee("");
    }
  }, [open]);
  function submit() {
    onCreate({
      title: title.trim() || "Untitled case",
      priority,
      assignee: assignee.trim() || "unassigned"
    });
  }
  return /*#__PURE__*/React.createElement(NcDialog, {
    open: open,
    onClose: onClose,
    title: "New case",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(NcButton, {
      variant: "ghost",
      onClick: onClose
    }, "Cancel"), /*#__PURE__*/React.createElement(NcButton, {
      variant: "primary",
      onClick: submit
    }, "Create case"))
  }, /*#__PURE__*/React.createElement("div", {
    className: "we-form"
  }, /*#__PURE__*/React.createElement(NcInput, {
    label: "Title",
    placeholder: "Build the\u2026",
    value: title,
    onChange: e => setTitle(e.target.value),
    onKeyDown: e => e.key === "Enter" && submit(),
    block: true,
    autoFocus: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "we-form__row"
  }, /*#__PURE__*/React.createElement(NcSelect, {
    label: "Priority",
    value: priority,
    onChange: e => setPriority(e.target.value),
    block: true,
    options: [{
      value: "low",
      label: "low"
    }, {
      value: "normal",
      label: "normal"
    }, {
      value: "high",
      label: "high"
    }]
  }), /*#__PURE__*/React.createElement(NcInput, {
    label: "Assignee",
    placeholder: "unassigned",
    value: assignee,
    onChange: e => setAssignee(e.target.value),
    block: true
  })), /*#__PURE__*/React.createElement("p", {
    className: "we-form__hint"
  }, "Opens at ", /*#__PURE__*/React.createElement(NcCode, {
    tone: "accent"
  }, NcWF.initial), " \xB7 workflow", " ", /*#__PURE__*/React.createElement(NcCode, null, NcWF.id), " \xB7 the three close-checks start unmet.")));
}
Object.assign(window, {
  NewCaseDialog
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/build-engine/NewCaseDialog.jsx", error: String((e && e.message) || e) }); }

// ui_kits/build-engine/WorkflowStepper.jsx
try { (() => {
/* WorkflowStepper — the ordered states as data (backlog → in_progress →
   in_review → done). States up to the current one read as travelled; the
   terminal node shows a gate hint when close-checks are unmet. */

const {
  STATE_META: StepMeta
} = window.DatacoreBuildEngine;
function WorkflowStepper({
  states,
  current,
  gateClear
}) {
  const ci = states.indexOf(current);
  const lastIdx = states.length - 1;
  return /*#__PURE__*/React.createElement("div", {
    className: "we-step"
  }, states.map((s, i) => {
    const meta = StepMeta[s];
    const state = i < ci ? "done" : i === ci ? "current" : "pending";
    const isTerminal = i === lastIdx;
    const gated = isTerminal && state !== "done" && !gateClear;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: s
    }, i > 0 && /*#__PURE__*/React.createElement("span", {
      className: "we-step__line" + (i <= ci ? " is-travelled" : "")
    }), /*#__PURE__*/React.createElement("span", {
      className: `we-step__node is-${state}${gated ? " is-gated" : ""}`,
      style: {
        "--tone": `var(--status-${meta.tone})`
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "we-step__dot"
    }, state === "done" ? "✓" : ""), /*#__PURE__*/React.createElement("span", {
      className: "we-step__label"
    }, meta.label)));
  }));
}
Object.assign(window, {
  WorkflowStepper
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/build-engine/WorkflowStepper.jsx", error: String((e && e.message) || e) }); }

// ui_kits/build-engine/engine.js
try { (() => {
/* build-engine — pure workflow engine stub + seed data.
   Mirrors crates/engine: WorkflowDef.evaluate(from, to, closeChecks) in the
   exact documented order — same-state no-op → unknown_status → transition
   membership → close-gate on entering terminal. Terminal = last(states). No IO,
   no deps. The same rules the Rust core compiles to wasm32 to run client-side. */

(function () {
  const WORKFLOW = {
    id: "feature",
    states: ["backlog", "in_progress", "in_review", "done"],
    transitions: {
      backlog: ["in_progress"],
      in_progress: ["in_review", "backlog"],
      in_review: ["done", "in_progress"],
      done: ["in_review"] // reopen (not gated)
    },
    initial: "backlog"
  };
  const isTerminal = (wf, s) => wf.states[wf.states.length - 1] === s;

  // → { allow:true, noop?:true } | { allow:false, kind, reason, missing? }
  function evaluate(wf, from, to, closeChecks) {
    if (from === to) return {
      allow: true,
      noop: true
    };
    if (!wf.states.includes(to)) return {
      allow: false,
      kind: "unknown_status",
      reason: `unknown_status: ${to}`
    };
    const allowed = wf.transitions[from] || [];
    if (!allowed.includes(to)) return {
      allow: false,
      kind: "invalid_transition",
      reason: `invalid_transition: ${from} → ${to}`
    };
    const entersTerminal = isTerminal(wf, to) && !isTerminal(wf, from);
    if (entersTerminal) {
      const missing = (closeChecks || []).filter(c => !c.passed).map(c => c.name);
      if (missing.length) return {
        allow: false,
        kind: "close_preconditions_unmet",
        reason: "close_preconditions_unmet",
        missing
      };
    }
    return {
      allow: true
    };
  }
  const STATE_META = {
    backlog: {
      label: "backlog",
      tone: "backlog"
    },
    in_progress: {
      label: "in progress",
      tone: "progress"
    },
    in_review: {
      label: "in review",
      tone: "review"
    },
    done: {
      label: "done",
      tone: "done"
    }
  };
  const PRIORITY_META = {
    high: {
      label: "high",
      tone: "danger"
    },
    normal: {
      label: "normal",
      tone: "neutral"
    },
    low: {
      label: "low",
      tone: "neutral"
    }
  };
  const ROLE_META = {
    Architect: {
      glyph: "◆",
      bi: "diagram-3",
      hue: "var(--accent)"
    },
    Coder: {
      glyph: "‹›",
      bi: "code-slash",
      hue: "var(--status-done)"
    },
    Tester: {
      glyph: "✓",
      bi: "check2-circle",
      hue: "var(--status-review)"
    },
    Reviewer: {
      glyph: "◎",
      bi: "eye",
      hue: "var(--neutral-500)"
    },
    Ops: {
      glyph: "⚙",
      bi: "gear",
      hue: "var(--text-muted)"
    }
  };
  const CASES = [{
    id: "CAS_277D2F5EFB9D46A99F1B0CB1F0CB166F",
    title: "Build the entity-rbac reach resolver",
    workflow: "feature",
    status: "done",
    priority: "normal",
    assignee: "coder",
    closeChecks: [{
      name: "docs-reconciled",
      passed: true,
      note: "README status + module docs updated"
    }, {
      name: "tests-green",
      passed: true,
      note: "13 engine unit + 3 rbac integration tests green"
    }, {
      name: "reviewer-approved",
      passed: true,
      note: "all checks verified"
    }],
    comments: [{
      role: "Architect",
      author: "ari",
      body: "Reach DESCENDS: a membership grants the object plus everything scoped beneath it, and never climbs to the parent. Pure engine::reachable must mirror the SQL recursive CTE.",
      at: "10:02"
    }, {
      role: "Coder",
      author: "kee",
      body: "Added engine::reachable (cycle-safe BFS), reach module (reachable_ids/can_reach), create_case now writes the entity_data edge, plus leak-free get/list filtering and GET /api/reach.",
      at: "12:48"
    }, {
      role: "Tester",
      author: "sol",
      body: "3 integration tests green incl. engine_resolver_agrees_with_the_sql_cte; engine unit tests now total 13.",
      at: "15:20"
    }, {
      role: "Reviewer",
      author: "wen",
      body: "Descend-not-climb verified, leak-free 404 matches absent, the CTE UNION dedups cycles, the pure resolver matches the SQL set. Approved.",
      at: "16:05"
    }],
    activity: [{
      text: "case_status backlog → in_progress",
      at: "10:00"
    }, {
      text: "case_close_check docs-reconciled = true",
      at: "13:10"
    }, {
      text: "case_close_check tests-green = true",
      at: "15:25"
    }, {
      text: "case_status in_progress → in_review",
      at: "15:30"
    }, {
      text: "case_close_check reviewer-approved = true",
      at: "16:05"
    }, {
      text: "case_status in_review → done",
      at: "16:06"
    }]
  }, {
    id: "CAS_9F4B12AE77C0451B83D1E0A6C4D29B70",
    title: "Generated reach CTE: compile from scope_parents",
    workflow: "feature",
    status: "in_review",
    priority: "high",
    assignee: "kee",
    closeChecks: [{
      name: "docs-reconciled",
      passed: true,
      note: "DATA-MODEL open-question #3 resolved"
    }, {
      name: "tests-green",
      passed: false,
      note: "powerset test for 3-level scope still red"
    }, {
      name: "reviewer-approved",
      passed: false,
      note: ""
    }],
    comments: [{
      role: "Architect",
      author: "ari",
      body: "One generated WITH RECURSIVE per type, compiled from each type's scope_parents. The minimal column set must not force a rework when the resolver lands.",
      at: "09:14"
    }, {
      role: "Coder",
      author: "kee",
      body: "CTE generator emits the UNION + cycle dedup. Wired behind GET /api/reach. Engine resolver kept as the agreement oracle.",
      at: "11:40"
    }, {
      role: "Tester",
      author: "sol",
      body: "2-level scope agrees. 3-level powerset still failing on a diamond — chasing a dedup edge case.",
      at: "14:22"
    }],
    activity: [{
      text: "case_status backlog → in_progress",
      at: "09:10"
    }, {
      text: "case_close_check docs-reconciled = true",
      at: "11:00"
    }, {
      text: "case_status in_progress → in_review",
      at: "13:30"
    }]
  }, {
    id: "CAS_4C1E88B0A9D74E2FAE6610F2D5B3C098",
    title: "MCP tool surface: mirror the 7 case operations",
    workflow: "feature",
    status: "in_progress",
    priority: "normal",
    assignee: "sol",
    closeChecks: [{
      name: "docs-reconciled",
      passed: false,
      note: ""
    }, {
      name: "tests-green",
      passed: true,
      note: "tool schemas validate against api::cases::svc"
    }, {
      name: "reviewer-approved",
      passed: false,
      note: ""
    }],
    comments: [{
      role: "Architect",
      author: "ari",
      body: "Tools delegate to the shared api::cases::svc so the orchestrator hits byte-identical validation. No second code path.",
      at: "08:50"
    }, {
      role: "Coder",
      author: "kee",
      body: "create_case / get_case / set_status / add_comment / set_close_check / set_assignee / list_cases wired over JSON-RPC stdio.",
      at: "10:30"
    }],
    activity: [{
      text: "case_status backlog → in_progress",
      at: "08:45"
    }, {
      text: "case_close_check tests-green = true",
      at: "10:35"
    }]
  }, {
    id: "CAS_A20D7731F6E54C9B8012AB34CD5566EE",
    title: "Time-partition the events audit log",
    workflow: "feature",
    status: "backlog",
    priority: "low",
    assignee: "unassigned",
    closeChecks: [{
      name: "docs-reconciled",
      passed: false,
      note: ""
    }, {
      name: "tests-green",
      passed: false,
      note: ""
    }, {
      name: "reviewer-approved",
      passed: false,
      note: ""
    }],
    comments: [{
      role: "Architect",
      author: "ari",
      body: "events is append-only; partition by month once volume warrants. Deferred — schema already supports it.",
      at: "Wed"
    }],
    activity: [{
      text: "case created at backlog",
      at: "Wed"
    }]
  }, {
    id: "CAS_E8B3445529AC41D7B9F00C7712AA63D1",
    title: "Scrub-audit: fail CI on forbidden identity tokens",
    workflow: "feature",
    status: "in_progress",
    priority: "high",
    assignee: "ops",
    closeChecks: [{
      name: "docs-reconciled",
      passed: false,
      note: ""
    }, {
      name: "tests-green",
      passed: true,
      note: "baseline diff gate green on the ratchet"
    }, {
      name: "reviewer-approved",
      passed: false,
      note: ""
    }],
    comments: [{
      role: "Ops",
      author: "ops",
      body: "ci.sh fails only on NEW violations vs the committed baseline, so the public code stays clean automatically.",
      at: "07:30"
    }],
    activity: [{
      text: "case_status backlog → in_progress",
      at: "07:25"
    }, {
      text: "case_close_check tests-green = true",
      at: "09:12"
    }]
  }];
  window.DatacoreBuildEngine = {
    WORKFLOW,
    evaluate,
    isTerminal,
    STATE_META,
    PRIORITY_META,
    ROLE_META,
    CASES
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/build-engine/engine.js", error: String((e && e.message) || e) }); }

// ui_kits/datatable/ColumnManager.jsx
try { (() => {
/* ColumnManager — a small popover that drives column projection (show/hide →
   the engine's `select`). Composes Checkbox + KindLabel. */

const {
  Checkbox: ColCheckbox,
  KindLabel: ColKind
} = window.DatacoreDesignSystem_a460c7;
function ColumnManager({
  headers,
  kinds,
  hidden,
  onToggle,
  onAll
}) {
  const shown = headers.length - hidden.size;
  return /*#__PURE__*/React.createElement("div", {
    className: "dt-pop",
    role: "dialog",
    "aria-label": "Columns"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dt-pop__head"
  }, /*#__PURE__*/React.createElement("span", null, "Columns"), /*#__PURE__*/React.createElement("span", {
    className: "dt-pop__meta"
  }, shown, "/", headers.length, " shown")), /*#__PURE__*/React.createElement("div", {
    className: "dt-pop__list"
  }, headers.map((h, i) => /*#__PURE__*/React.createElement("label", {
    key: i,
    className: "dt-pop__row"
  }, /*#__PURE__*/React.createElement(ColCheckbox, {
    checked: !hidden.has(i),
    onChange: () => onToggle(i),
    disabled: !hidden.has(i) && headers.length - hidden.size === 1
  }), /*#__PURE__*/React.createElement("span", {
    className: "dt-pop__name"
  }, h), /*#__PURE__*/React.createElement(ColKind, {
    kind: kinds[i]
  })))), /*#__PURE__*/React.createElement("div", {
    className: "dt-pop__foot"
  }, /*#__PURE__*/React.createElement("button", {
    className: "dt-link",
    onClick: () => onAll(true)
  }, "Show all"), /*#__PURE__*/React.createElement("button", {
    className: "dt-link",
    onClick: () => onAll(false)
  }, "Hide all")));
}
Object.assign(window, {
  ColumnManager
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/datatable/ColumnManager.jsx", error: String((e && e.message) || e) }); }

// ui_kits/datatable/DataGrid.jsx
try { (() => {
/* DataGrid — the loaded-table view. Real <table> semantics: each header sorts
   (shift-click adds a level → multi-sort, shown with an order number) and opens
   a per-column filter popover. Right-aligned numerics, zebra rows, sticky head.
   Renders only the current page. Composes KindLabel + Icon + Tooltip + the
   kit-local FilterPopover. */

const {
  KindLabel,
  Icon: GridIcon,
  Tooltip: GridTooltip
} = window.DatacoreDesignSystem_a460c7;
function DataGrid({
  headers,
  kinds,
  rows,
  sorts,
  filters,
  hidden,
  onSort,
  onOpenFilter
}) {
  const isNum = i => kinds[i] === "Int" || kinds[i] === "Float";
  const cols = headers.map((_, i) => i).filter(i => !hidden.has(i));
  const sortOf = i => sorts.find(s => s.col === i);
  const multi = sorts.length > 1;
  return /*#__PURE__*/React.createElement("div", {
    className: "dt-wrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "dt-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, cols.map(i => {
    const s = sortOf(i);
    const active = !!s;
    const hasFilter = !!filters[i];
    const ord = active && multi ? sorts.indexOf(s) + 1 : null;
    return /*#__PURE__*/React.createElement("th", {
      key: i,
      className: isNum(i) ? "num" : "",
      "aria-sort": active ? s.asc ? "ascending" : "descending" : "none"
    }, /*#__PURE__*/React.createElement("span", {
      className: "dt-th"
    }, /*#__PURE__*/React.createElement(GridTooltip, {
      content: "Sort \xB7 shift-click to add a level"
    }, /*#__PURE__*/React.createElement("button", {
      className: "dt-sort" + (active ? " is-active" : ""),
      onClick: e => onSort(i, e.shiftKey)
    }, /*#__PURE__*/React.createElement("span", {
      className: "dt-name"
    }, headers[i]), /*#__PURE__*/React.createElement(KindLabel, {
      kind: kinds[i]
    }), /*#__PURE__*/React.createElement("span", {
      className: "dt-sort__icon"
    }, /*#__PURE__*/React.createElement(GridIcon, {
      name: active ? s.asc ? "sort-up" : "sort-down" : "arrow-down-up"
    }), ord && /*#__PURE__*/React.createElement("span", {
      className: "dt-sort__ord"
    }, ord)))), /*#__PURE__*/React.createElement("button", {
      className: "dt-funnel" + (hasFilter ? " is-active" : ""),
      "aria-label": `Filter ${headers[i]}`,
      onClick: e => onOpenFilter(i, e.currentTarget.getBoundingClientRect())
    }, /*#__PURE__*/React.createElement(GridIcon, {
      name: hasFilter ? "funnel-fill" : "funnel"
    }))));
  }))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, ri) => /*#__PURE__*/React.createElement("tr", {
    key: ri
  }, cols.map(i => /*#__PURE__*/React.createElement("td", {
    key: i,
    className: isNum(i) ? "num" : ""
  }, r[i] === "" || r[i] == null ? /*#__PURE__*/React.createElement("span", {
    className: "dt-null"
  }, "\u2205") : kinds[i] === "Bool" && (r[i] === "true" || r[i] === "false") ? /*#__PURE__*/React.createElement("span", {
    className: "dt-bool dt-bool--" + r[i]
  }, /*#__PURE__*/React.createElement(GridIcon, {
    name: r[i] === "true" ? "check-circle-fill" : "circle"
  }), " ", r[i]) : String(r[i]))))), rows.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    className: "dt-norows",
    colSpan: cols.length
  }, "No rows match the current filters.")))));
}
Object.assign(window, {
  DataGrid
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/datatable/DataGrid.jsx", error: String((e && e.message) || e) }); }

// ui_kits/datatable/DatatableApp.jsx
try { (() => {
/* DatatableApp — the orchestrator. Empty (drop zone) ⇄ loaded (table). Owns the
   base handle + view state (global search, per-column filters, multi-sort, page)
   and recomposes the view (search → filter → sort → page) on every change,
   handing only the visible window to the grid. Mirrors the front-end brief's
   wiring model. Composes the Datacore primitives. */

const {
  Toolbar,
  Button,
  IconButton,
  EmptyState,
  Badge,
  Code,
  Input,
  Icon,
  Toast
} = window.DatacoreDesignSystem_a460c7;
const {
  Table,
  SAMPLE_CSV
} = window.DatacoreTableEngine;
const {
  useState,
  useRef,
  useMemo,
  useEffect
} = React;
const OP_LABEL = {
  eq: "=",
  ne: "≠",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  contains: "∋"
};
function anchorPos(rect) {
  if (!rect) return {
    left: "50%",
    top: "18%",
    transform: "translateX(-50%)"
  };
  const w = 240;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
  return {
    left: left + "px",
    top: rect.bottom + 6 + "px"
  };
}
function DatatableApp() {
  const [base, setBase] = useState(null);
  const [fileName, setFileName] = useState("");
  const [sorts, setSorts] = useState([]); // [{col, asc}] — multi-sort
  const [filters, setFilters] = useState({}); // {col: {op, value}}
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [over, setOver] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(null);
  const [toasts, setToasts] = useState([]);
  const fileRef = useRef(null);
  useEffect(() => {
    openCsv(SAMPLE_CSV, "customers.sample.csv");
  }, []);
  function pushToast(t) {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, {
      id,
      ...t
    }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3600);
  }
  function openCsv(text, name) {
    const t = Table.fromCsv(text);
    setBase(t);
    setFileName(name || "table.csv");
    setSorts([]);
    setFilters({});
    setSearch("");
    setHidden(new Set());
    setPage(0);
    setColsOpen(false);
    setFilterOpen(null);
    pushToast({
      tone: "info",
      title: "Loaded " + (name || "table.csv"),
      description: `${t.nrows().toLocaleString()} rows · ${t.ncols()} columns`
    });
  }
  function closeFile() {
    setBase(null);
    setFileName("");
    setSorts([]);
    setFilters({});
    setSearch("");
    setHidden(new Set());
    setColsOpen(false);
    setFilterOpen(null);
  }
  function readFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => openCsv(r.result, file.name);
    r.readAsText(file);
  }

  // compose the view: search → per-column filters → multi-sort (stable, applied
  // least-significant first). Paging happens at render.
  const view = useMemo(() => {
    if (!base) return null;
    let v = base.search(search);
    for (const c in filters) {
      const f = filters[c];
      if (!f || String(f.value).trim() === "") continue;
      v = v.filter(Number(c), f.op, f.value);
    }
    for (let k = sorts.length - 1; k >= 0; k--) v = v.sort(sorts[k].col, sorts[k].asc);
    return v;
  }, [base, search, filters, sorts]);
  const filtered = view ? view.nrows() : 0;
  const loaded = base ? base.nrows() : 0;
  const pages = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [pages, page]);
  const safePage = Math.min(page, pages - 1);
  const pageRows = view ? view.page(safePage * pageSize, pageSize) : [];
  function onSort(col, additive) {
    setSorts(cur => {
      const idx = cur.findIndex(s => s.col === col);
      if (additive) {
        if (idx < 0) return [...cur, {
          col,
          asc: true
        }];
        const next = cur.slice();
        next[idx] = {
          col,
          asc: !next[idx].asc
        };
        return next;
      }
      if (idx >= 0 && cur.length === 1) return [{
        col,
        asc: !cur[0].asc
      }];
      return [{
        col,
        asc: true
      }];
    });
  }
  function applyFilter(col, f) {
    setFilters(m => ({
      ...m,
      [col]: f
    }));
    setFilterOpen(null);
    setPage(0);
  }
  function clearFilter(col) {
    setFilters(m => {
      const n = {
        ...m
      };
      delete n[col];
      return n;
    });
    setFilterOpen(null);
    setPage(0);
  }
  function toggleCol(i) {
    setHidden(h => {
      const n = new Set(h);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }
  function allCols(show) {
    setHidden(show ? new Set() : new Set(base.headers().map((_, i) => i).slice(1)));
  }
  function exportCsv() {
    if (!view) return;
    const cols = base.headers().map((_, i) => i).filter(i => !hidden.has(i));
    const out = view.select(cols).toCsv();
    const blob = new Blob([out], {
      type: "text/csv"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.csv$/i, "") + ".filtered.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    pushToast({
      tone: "success",
      title: `Exported ${filtered.toLocaleString()} rows`,
      description: a.download
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "dt-app",
    onDragOver: e => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: e => {
      e.preventDefault();
      setOver(false);
      readFile(e.dataTransfer.files[0]);
    }
  }, /*#__PURE__*/React.createElement("input", {
    ref: fileRef,
    type: "file",
    accept: ".csv,text/csv",
    hidden: true,
    onChange: e => readFile(e.target.files[0])
  }), /*#__PURE__*/React.createElement(Toolbar, {
    sticky: true,
    left: /*#__PURE__*/React.createElement("div", {
      className: "dt-brand"
    }, /*#__PURE__*/React.createElement("span", {
      className: "dt-logo",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("h1", {
      className: "dt-title"
    }, "advanced-datatable"), /*#__PURE__*/React.createElement("span", {
      className: "dt-meta-priv"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "shield-lock"
    }), " your data never leaves this page")),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, base && /*#__PURE__*/React.createElement("span", {
      className: "dt-search"
    }, /*#__PURE__*/React.createElement(Input, {
      size: "sm",
      value: search,
      onChange: e => {
        setSearch(e.target.value);
        setPage(0);
      },
      placeholder: "Search all columns\u2026",
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "search"
      }),
      block: true
    })), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "upload"
      }),
      onClick: () => fileRef.current.click()
    }, "Open CSV"), /*#__PURE__*/React.createElement("span", {
      className: "dt-colwrap"
    }, /*#__PURE__*/React.createElement(Button, {
      onClick: () => setColsOpen(v => !v),
      disabled: !base,
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "layout-three-columns"
      }),
      trailingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "chevron-down",
        size: ".7em"
      })
    }, "Columns"), colsOpen && base && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "dt-pop__scrim",
      onClick: () => setColsOpen(false)
    }), /*#__PURE__*/React.createElement(ColumnManager, {
      headers: base.headers(),
      kinds: base.kinds(),
      hidden: hidden,
      onToggle: toggleCol,
      onAll: allCols
    }))), /*#__PURE__*/React.createElement(Button, {
      onClick: exportCsv,
      disabled: !base,
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "download"
      })
    }, "Export CSV"), base && /*#__PURE__*/React.createElement(IconButton, {
      label: "Close file",
      onClick: closeFile
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x-lg"
    })))
  }), base ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "dt-count"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dt-count__rows"
  }, filtered.toLocaleString(), " rows"), /*#__PURE__*/React.createElement("span", {
    className: "dt-count__sep"
  }, "\xB7"), /*#__PURE__*/React.createElement(Code, {
    truncate: true,
    tone: "muted"
  }, fileName), filtered !== loaded && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "dt-count__sep"
  }, "\xB7"), /*#__PURE__*/React.createElement(Badge, {
    tone: "accent",
    square: true
  }, (loaded - filtered).toLocaleString(), " filtered out")), sorts.map(s => /*#__PURE__*/React.createElement("span", {
    key: s.col,
    className: "dt-sortchip",
    onClick: () => onSort(s.col, false),
    title: "Click to flip \xB7 this is a sort level"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.asc ? "sort-up" : "sort-down"
  }), base.headers()[s.col], /*#__PURE__*/React.createElement("button", {
    className: "dt-sortchip__x",
    "aria-label": "Remove sort",
    onClick: e => {
      e.stopPropagation();
      setSorts(cur => cur.filter(x => x.col !== s.col));
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: ".85rem"
  })))), Object.keys(filters).map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    className: "dt-filterchip",
    onClick: e => setFilterOpen({
      col: Number(c),
      rect: e.currentTarget.getBoundingClientRect()
    })
  }, base.headers()[c], " ", /*#__PURE__*/React.createElement("b", null, OP_LABEL[filters[c].op] || filters[c].op), " ", String(filters[c].value), /*#__PURE__*/React.createElement("button", {
    className: "dt-sortchip__x",
    "aria-label": "Clear filter",
    onClick: e => {
      e.stopPropagation();
      clearFilter(Number(c));
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: ".85rem"
  })))), /*#__PURE__*/React.createElement("span", {
    className: "dt-spacer"
  }), /*#__PURE__*/React.createElement("span", {
    className: "dt-count__priv"
  }, "All processing happens in your browser")), /*#__PURE__*/React.createElement(DataGrid, {
    headers: base.headers(),
    kinds: base.kinds(),
    rows: pageRows,
    sorts: sorts,
    filters: filters,
    hidden: hidden,
    onSort: onSort,
    onOpenFilter: (col, rect) => setFilterOpen({
      col,
      rect
    })
  }), /*#__PURE__*/React.createElement(Pagination, {
    total: filtered,
    page: safePage,
    pageSize: pageSize,
    onPage: setPage,
    onPageSize: n => {
      setPageSize(n);
      setPage(0);
    }
  })) : /*#__PURE__*/React.createElement("div", {
    className: "dt-emptyhost"
  }, /*#__PURE__*/React.createElement(EmptyState, {
    dropzone: true,
    over: over,
    glyph: /*#__PURE__*/React.createElement(Icon, {
      name: "filetype-csv",
      size: "1.9rem"
    }),
    lead: "Open a CSV \u2014 it stays on your device.",
    description: "All processing happens in your browser. Nothing is uploaded, nothing leaves this page.",
    action: /*#__PURE__*/React.createElement("div", {
      className: "dt-empty-actions"
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "upload"
      }),
      onClick: () => fileRef.current.click()
    }, "Open CSV"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => openCsv(SAMPLE_CSV, "customers.sample.csv")
    }, "Load sample data"))
  })), filterOpen && base && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "dt-pop__scrim",
    onClick: () => setFilterOpen(null)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      zIndex: 61,
      ...anchorPos(filterOpen.rect)
    }
  }, /*#__PURE__*/React.createElement(FilterPopover, {
    header: base.headers()[filterOpen.col],
    kind: base.kinds()[filterOpen.col],
    filter: filters[filterOpen.col],
    onApply: f => applyFilter(filterOpen.col, f),
    onClear: () => clearFilter(filterOpen.col)
  }))), /*#__PURE__*/React.createElement("div", {
    className: "dt-toasts"
  }, toasts.map(t => /*#__PURE__*/React.createElement(Toast, {
    key: t.id,
    tone: t.tone,
    title: t.title,
    description: t.description,
    onClose: () => setToasts(ts => ts.filter(x => x.id !== t.id))
  }))));
}
Object.assign(window, {
  DatatableApp
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/datatable/DatatableApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/datatable/FilterPopover.jsx
try { (() => {
/* FilterPopover — explicit per-column filter: an operator picker (offered by the
   column's kind) plus a value. Replaces free-text operator guessing with a clear
   contract that mirrors the engine's filter ops. Composes Select + Input + Button. */

const {
  Select: FpSelect,
  Input: FpInput,
  Button: FpButton,
  Icon: FpIcon
} = window.DatacoreDesignSystem_a460c7;
const NUM_OPS = [{
  value: "eq",
  label: "=  equals"
}, {
  value: "ne",
  label: "≠  not equal"
}, {
  value: "lt",
  label: "<  less than"
}, {
  value: "le",
  label: "≤  at most"
}, {
  value: "gt",
  label: ">  greater than"
}, {
  value: "ge",
  label: "≥  at least"
}];
const TEXT_OPS = [{
  value: "contains",
  label: "contains"
}, {
  value: "eq",
  label: "=  equals"
}, {
  value: "ne",
  label: "≠  not equal"
}];
function FilterPopover({
  header,
  kind,
  filter,
  onApply,
  onClear
}) {
  const numeric = kind === "Int" || kind === "Float";
  const isBool = kind === "Bool";
  const ops = numeric ? NUM_OPS : isBool ? [{
    value: "eq",
    label: "=  is"
  }] : TEXT_OPS;
  const [op, setOp] = React.useState(filter && filter.op || ops[0].value);
  const [value, setValue] = React.useState(filter ? filter.value : isBool ? "true" : "");
  function apply(e) {
    e.preventDefault();
    if (String(value).trim() === "") {
      onClear();
      return;
    }
    onApply({
      op,
      value
    });
  }
  return /*#__PURE__*/React.createElement("form", {
    className: "dt-pop dt-fpop",
    onSubmit: apply,
    role: "dialog",
    "aria-label": `Filter ${header}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "dt-pop__head"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(FpIcon, {
    name: "funnel"
  }), " \xA0", header)), /*#__PURE__*/React.createElement("div", {
    className: "dt-fpop__body"
  }, /*#__PURE__*/React.createElement(FpSelect, {
    size: "sm",
    block: true,
    value: op,
    onChange: e => setOp(e.target.value),
    options: ops
  }), isBool ? /*#__PURE__*/React.createElement(FpSelect, {
    size: "sm",
    block: true,
    value: value || "true",
    onChange: e => setValue(e.target.value),
    options: [{
      value: "true",
      label: "true"
    }, {
      value: "false",
      label: "false"
    }]
  }) : /*#__PURE__*/React.createElement(FpInput, {
    size: "sm",
    block: true,
    autoFocus: true,
    value: value,
    onChange: e => setValue(e.target.value),
    placeholder: numeric ? "value" : "text…"
  })), /*#__PURE__*/React.createElement("div", {
    className: "dt-pop__foot dt-fpop__foot"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "dt-link",
    onClick: onClear
  }, "Clear"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(FpButton, {
    type: "submit",
    size: "sm",
    variant: "primary"
  }, "Apply")));
}
Object.assign(window, {
  FilterPopover
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/datatable/FilterPopover.jsx", error: String((e && e.message) || e) }); }

// ui_kits/datatable/Pagination.jsx
try { (() => {
/* Pagination — the bottom bar. Page-size picker, range readout, and first/prev/
   next/last controls. Pages only the visible window so the DOM never holds more
   than `pageSize` rows. Composes Select + IconButton + Icon. */

const {
  Select: PgSelect,
  IconButton: PgIconButton,
  Icon: PgIcon
} = window.DatacoreDesignSystem_a460c7;
function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return /*#__PURE__*/React.createElement("div", {
    className: "dt-pager"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dt-pager__lbl"
  }, "Rows per page"), /*#__PURE__*/React.createElement(PgSelect, {
    size: "sm",
    value: String(pageSize),
    onChange: e => onPageSize(Number(e.target.value)),
    options: ["25", "50", "100", "250"]
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "dt-pager__range"
  }, start.toLocaleString(), "\u2013", end.toLocaleString(), " of ", total.toLocaleString()), /*#__PURE__*/React.createElement("span", {
    className: "dt-pager__btns"
  }, /*#__PURE__*/React.createElement(PgIconButton, {
    label: "First page",
    disabled: page === 0,
    onClick: () => onPage(0)
  }, /*#__PURE__*/React.createElement(PgIcon, {
    name: "chevron-bar-left"
  })), /*#__PURE__*/React.createElement(PgIconButton, {
    label: "Previous page",
    disabled: page === 0,
    onClick: () => onPage(page - 1)
  }, /*#__PURE__*/React.createElement(PgIcon, {
    name: "chevron-left"
  })), /*#__PURE__*/React.createElement("span", {
    className: "dt-pager__no"
  }, page + 1, " / ", pages), /*#__PURE__*/React.createElement(PgIconButton, {
    label: "Next page",
    disabled: page >= pages - 1,
    onClick: () => onPage(page + 1)
  }, /*#__PURE__*/React.createElement(PgIcon, {
    name: "chevron-right"
  })), /*#__PURE__*/React.createElement(PgIconButton, {
    label: "Last page",
    disabled: page >= pages - 1,
    onClick: () => onPage(pages - 1)
  }, /*#__PURE__*/React.createElement(PgIcon, {
    name: "chevron-bar-right"
  }))));
}
Object.assign(window, {
  Pagination
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/datatable/Pagination.jsx", error: String((e && e.message) || e) }); }

// ui_kits/datatable/tableEngine.js
try { (() => {
/* Datacore datatable — JS table engine stub.
   Mirrors the wasm `WasmTable` JS API from docs/spec.md exactly
   (from_csv · headers · kinds · nrows · filter · sort · select · page · to_csv)
   so the UI is wired the way the real engine expects. Operations return a NEW
   handle, so the view is composed filter → sort → select and only the visible
   window is paged. Pure JS, no deps — the same "runs entirely on your machine"
   spirit as the Rust core. */

(function () {
  // ---- CSV parse (RFC-4180-ish) ----------------------------------------
  function parseCsv(text) {
    const rows = [];
    let row = [],
      field = "",
      q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else q = false;
        } else field += c;
      } else if (c === '"') q = true;else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(r => r.length > 1 || r.length === 1 && r[0] !== "");
  }

  // ---- type inference: Int | Float | Bool | Text -----------------------
  const isInt = s => /^-?\d+$/.test(s.trim());
  const isFloat = s => /^-?\d*\.\d+$/.test(s.trim()) || isInt(s);
  const isBool = s => /^(true|false)$/i.test(s.trim());
  function inferKind(values) {
    const nonEmpty = values.filter(v => v !== "" && v != null);
    if (!nonEmpty.length) return "Text";
    if (nonEmpty.every(isInt)) return "Int";
    if (nonEmpty.every(isFloat)) return "Float";
    if (nonEmpty.every(isBool)) return "Bool";
    return "Text";
  }
  const NUM = k => k === "Int" || k === "Float";
  class Table {
    constructor(headers, kinds, rows) {
      this._headers = headers;
      this._kinds = kinds;
      this._rows = rows; // array of string[]
    }
    static fromCsv(text) {
      const grid = parseCsv(text);
      if (!grid.length) return new Table([], [], []);
      const headers = grid[0];
      const body = grid.slice(1);
      const kinds = headers.map((_, c) => inferKind(body.map(r => r[c] ?? "")));
      return new Table(headers, kinds, body);
    }
    headers() {
      return this._headers.slice();
    }
    kinds() {
      return this._kinds.slice();
    }
    nrows() {
      return this._rows.length;
    }
    ncols() {
      return this._headers.length;
    }
    col(name) {
      const i = this._headers.indexOf(name);
      return i < 0 ? null : i;
    }
    filter(c, op, value) {
      const kind = this._kinds[c];
      const numeric = NUM(kind);
      const target = numeric ? parseFloat(value) : String(value).toLowerCase();
      const rows = this._rows.filter(r => {
        const cell = r[c];
        if (cell === "" || cell == null) return false; // Null never orders true
        if (numeric) {
          const n = parseFloat(cell);
          if (Number.isNaN(n) || Number.isNaN(target)) return false;
          switch (op) {
            case "eq":
              return n === target;
            case "ne":
              return n !== target;
            case "lt":
              return n < target;
            case "le":
              return n <= target;
            case "gt":
              return n > target;
            case "ge":
              return n >= target;
            default:
              return true;
          }
        }
        const s = String(cell).toLowerCase();
        switch (op) {
          case "eq":
            return s === target;
          case "ne":
            return s !== target;
          case "contains":
            return s.includes(target);
          default:
            return s.includes(target);
        }
      });
      return new Table(this._headers, this._kinds, rows);
    }
    sort(c, ascending) {
      const numeric = NUM(this._kinds[c]);
      const rows = this._rows.slice().sort((a, b) => {
        const av = a[c],
          bv = b[c];
        const an = av === "" || av == null,
          bn = bv === "" || bv == null;
        if (an && bn) return 0;
        if (an) return 1; // Nulls always last
        if (bn) return -1;
        let cmp;
        if (numeric) cmp = parseFloat(av) - parseFloat(bv);else cmp = String(av).localeCompare(String(bv));
        return ascending ? cmp : -cmp;
      });
      return new Table(this._headers, this._kinds, rows);
    }
    select(cols) {
      const headers = cols.map(c => this._headers[c]);
      const kinds = cols.map(c => this._kinds[c]);
      const rows = this._rows.map(r => cols.map(c => r[c]));
      return new Table(headers, kinds, rows);
    }

    // cross-column free-text search (any cell contains the term)
    search(term) {
      const t = String(term).trim().toLowerCase();
      if (!t) return this;
      const rows = this._rows.filter(r => r.some(c => String(c).toLowerCase().includes(t)));
      return new Table(this._headers, this._kinds, rows);
    }
    page(offset, limit) {
      return this._rows.slice(offset, offset + limit);
    }
    toCsv() {
      const esc = s => /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s;
      return [this._headers, ...this._rows].map(r => r.map(esc).join(",")).join("\n");
    }
  }

  // ---- deterministic sample dataset ------------------------------------
  function sampleCsv() {
    const regions = ["NA", "EMEA", "APAC", "LATAM"];
    const plans = ["Free", "Pro", "Team", "Enterprise"];
    const cos = ["Northwind", "Acme", "Globex", "Initech", "Umbra", "Hooli", "Stark", "Wayne", "Soylent", "Vandelay", "Wonka", "Tyrell", "Cyberdyne", "Aperture", "Black Mesa", "Pied Piper"];
    const seatsBy = {
      Free: [1, 3],
      Pro: [2, 12],
      Team: [8, 40],
      Enterprise: [40, 320]
    };
    const mrrPer = {
      Free: 0,
      Pro: 12,
      Team: 9,
      Enterprise: 7.5
    };
    let rng = 1337;
    const rand = () => (rng = rng * 1103515245 + 12345 & 0x7fffffff) / 0x7fffffff;
    const rows = [["id", "customer", "region", "plan", "seats", "mrr", "active", "signup"]];
    for (let i = 0; i < 48; i++) {
      const plan = plans[Math.floor(rand() * plans.length)];
      const [lo, hi] = seatsBy[plan];
      const seats = Math.floor(lo + rand() * (hi - lo));
      const mrr = (seats * mrrPer[plan] * (0.9 + rand() * 0.2)).toFixed(2);
      const region = regions[Math.floor(rand() * regions.length)];
      const co = cos[Math.floor(rand() * cos.length)] + " " + (Math.floor(rand() * 90) + 10);
      const active = rand() > 0.22 ? "true" : "false";
      const y = 2023 + Math.floor(rand() * 3);
      const m = String(1 + Math.floor(rand() * 12)).padStart(2, "0");
      const d = String(1 + Math.floor(rand() * 28)).padStart(2, "0");
      rows.push([1001 + i, co, region, plan, seats, mrr, active, `${y}-${m}-${d}`]);
    }
    return rows.map(r => r.join(",")).join("\n");
  }
  window.DatacoreTableEngine = {
    Table,
    parseCsv,
    inferKind,
    SAMPLE_CSV: sampleCsv()
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/datatable/tableEngine.js", error: String((e && e.message) || e) }); }

// ui_kits/echarts-dashboard/ChartCard.jsx
try { (() => {
/* ChartCard — one configurable chart. A compact control row (group-by ·
   aggregate · measure · type) drives the engine's aggregate() and feeds the
   { labels, values } series into the Datacore Chart (token-themed ECharts). The
   measure select hides when the aggregate is `count`. Export PNG via the chart
   instance's getDataURL. Composes Card + Select + IconButton + Icon + Chart. */

const {
  Card: CcCard,
  Select: CcSelect,
  IconButton: CcIconButton,
  Icon: CcIcon,
  Chart: CcChart,
  Tooltip: CcTooltip
} = window.DatacoreDesignSystem_a460c7;
const {
  useState,
  useMemo,
  useRef
} = React;
const AGGS = ["count", "sum", "avg", "min", "max"];
const TYPES = ["bar", "line", "pie"];
function ChartCard({
  data,
  headers,
  kinds,
  defaults,
  onRemove
}) {
  const numericCols = useMemo(() => kinds.map((k, i) => k === "Number" ? i : -1).filter(i => i >= 0), [kinds]);
  const firstText = Math.max(0, kinds.indexOf("Text"));
  const firstNum = numericCols.length ? numericCols[0] : 0;
  const [cat, setCat] = useState(defaults?.cat ?? firstText);
  const [agg, setAgg] = useState(defaults?.agg ?? "count");
  const [measure, setMeasure] = useState(defaults?.measure ?? firstNum);
  const [type, setType] = useState(defaults?.type ?? "bar");
  const chartRef = useRef(null);
  const showMeasure = agg !== "count" && numericCols.length > 0;
  const series = useMemo(() => data.aggregate(cat, showMeasure ? measure : -1, agg), [data, cat, measure, agg, showMeasure]);
  const title = (agg === "count" ? "count" : `${agg} ${headers[measure] ?? ""}`) + ` by ${headers[cat]}`;
  const option = useMemo(() => {
    const {
      labels,
      values
    } = series;
    if (type === "pie") {
      return {
        tooltip: {
          trigger: "item"
        },
        legend: {
          type: "scroll",
          bottom: 0,
          left: "center"
        },
        series: [{
          type: "pie",
          radius: ["40%", "68%"],
          center: ["50%", "46%"],
          data: labels.map((l, i) => ({
            name: l,
            value: values[i]
          }))
        }]
      };
    }
    return {
      tooltip: {
        trigger: "axis"
      },
      grid: {
        left: 46,
        right: 14,
        top: 16,
        bottom: labels.length > 6 ? 52 : 30
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          rotate: labels.length > 6 ? 32 : 0
        }
      },
      yAxis: {
        type: "value"
      },
      series: [{
        type,
        data: values
      }]
    };
  }, [series, type]);
  function exportPng() {
    const inst = chartRef.current;
    if (!inst) return;
    const url = inst.getDataURL({
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).getPropertyValue("--surface") || "#fff"
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png";
    a.click();
  }
  const controls = /*#__PURE__*/React.createElement("div", {
    className: "db-ctrls"
  }, /*#__PURE__*/React.createElement(CcSelect, {
    size: "sm",
    value: String(cat),
    onChange: e => setCat(+e.target.value),
    options: headers.map((h, i) => ({
      value: String(i),
      label: h
    }))
  }), /*#__PURE__*/React.createElement(CcSelect, {
    size: "sm",
    value: agg,
    onChange: e => setAgg(e.target.value),
    options: AGGS.map(a => ({
      value: a,
      label: a
    }))
  }), showMeasure && /*#__PURE__*/React.createElement(CcSelect, {
    size: "sm",
    value: String(measure),
    onChange: e => setMeasure(+e.target.value),
    options: numericCols.map(i => ({
      value: String(i),
      label: headers[i]
    }))
  }), /*#__PURE__*/React.createElement(CcSelect, {
    size: "sm",
    value: type,
    onChange: e => setType(e.target.value),
    options: TYPES.map(t => ({
      value: t,
      label: t
    }))
  }));
  const actions = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(CcTooltip, {
    content: "Export PNG"
  }, /*#__PURE__*/React.createElement(CcIconButton, {
    label: "Export PNG",
    onClick: exportPng
  }, /*#__PURE__*/React.createElement(CcIcon, {
    name: "download"
  }))), /*#__PURE__*/React.createElement(CcTooltip, {
    content: "Remove chart"
  }, /*#__PURE__*/React.createElement(CcIconButton, {
    label: "Remove chart",
    onClick: onRemove
  }, /*#__PURE__*/React.createElement(CcIcon, {
    name: "x-lg"
  }))));
  return /*#__PURE__*/React.createElement(Card, {
    className: "db-card",
    title: /*#__PURE__*/React.createElement("span", {
      className: "db-card__title"
    }, title),
    actions: actions,
    flush: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "db-card__body"
  }, controls, /*#__PURE__*/React.createElement(CcChart, {
    style: {
      height: "15rem"
    },
    option: option,
    onReady: inst => chartRef.current = inst
  })));
}
Object.assign(window, {
  ChartCard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/echarts-dashboard/ChartCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/echarts-dashboard/EchartsDashboardApp.jsx
try { (() => {
/* EchartsDashboardApp — the orchestrator. Empty (drop zone) ⇄ dashboard (KPI
   strip + chart-card grid). Opens a CSV through the engine (WasmData.fromCsv),
   seeds a sensible default card (and a numeric one if available), and lets you
   add/remove cards. The KPI strip summarizes rows / columns / numeric columns /
   distinct groups. The file never leaves the page. Composes the Datacore
   primitives + the kit-local ChartCard. */

const DB = window.DatacoreDesignSystem_a460c7;
const DE = window.DatacoreDashboard;
const {
  Toolbar: DToolbar,
  Button: DButton,
  IconButton: DIconButton,
  EmptyState: DEmpty,
  Stat: DStat,
  Icon: DIcon,
  Toast: DToast
} = DB;
const {
  WasmData,
  SAMPLE_CSV
} = DE;
const {
  useState,
  useRef,
  useEffect
} = React;
let cardSeq = 0;
function EchartsDashboardApp() {
  const [data, setData] = useState(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [cards, setCards] = useState([]);
  const [over, setOver] = useState(false);
  const [toasts, setToasts] = useState([]);
  const fileRef = useRef(null);
  useEffect(() => {
    openCsv(SAMPLE_CSV, "customers.sample.csv");
  }, []);
  function pushToast(t) {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, {
      id,
      ...t
    }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3400);
  }
  function openCsv(text, name) {
    const d = WasmData.fromCsv(text);
    const hs = d.headers(),
      ks = d.kinds();
    setData(d);
    setHeaders(hs);
    setKinds(ks);
    setFileName(name || "table.csv");
    const firstText = Math.max(0, ks.indexOf("Text"));
    const nums = ks.map((k, i) => k === "Number" ? i : -1).filter(i => i >= 0);
    const seed = [{
      id: cardSeq++,
      cat: firstText,
      agg: "count",
      measure: nums[0] ?? 0,
      type: "bar"
    }];
    if (nums.length) seed.push({
      id: cardSeq++,
      cat: firstText,
      agg: "sum",
      measure: nums[0],
      type: "pie"
    });
    setCards(seed);
    pushToast({
      tone: "info",
      title: "Loaded " + (name || "table.csv"),
      description: `${d.nrows().toLocaleString()} rows · ${hs.length} columns`
    });
  }
  function closeFile() {
    setData(null);
    setCards([]);
    setHeaders([]);
    setKinds([]);
    setFileName("");
  }
  function readFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => openCsv(r.result, file.name);
    r.readAsText(file);
  }
  function addCard() {
    const firstText = Math.max(0, kinds.indexOf("Text"));
    const nums = kinds.map((k, i) => k === "Number" ? i : -1).filter(i => i >= 0);
    setCards(cs => [...cs, {
      id: cardSeq++,
      cat: firstText,
      agg: nums.length ? "sum" : "count",
      measure: nums[0] ?? 0,
      type: "bar"
    }]);
  }
  function removeCard(id) {
    setCards(cs => cs.filter(c => c.id !== id));
  }
  const numericCount = kinds.filter(k => k === "Number").length;
  const distinctFirst = data && headers.length ? data.distinct(Math.max(0, kinds.indexOf("Text"))) : 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "db-app",
    onDragOver: e => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: e => {
      e.preventDefault();
      setOver(false);
      readFile(e.dataTransfer.files[0]);
    }
  }, /*#__PURE__*/React.createElement("input", {
    ref: fileRef,
    type: "file",
    accept: ".csv,text/csv",
    hidden: true,
    onChange: e => readFile(e.target.files[0])
  }), /*#__PURE__*/React.createElement(DToolbar, {
    sticky: true,
    left: /*#__PURE__*/React.createElement("div", {
      className: "db-brand"
    }, /*#__PURE__*/React.createElement("span", {
      className: "db-logo",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("h1", {
      className: "db-title"
    }, "echarts-dashboard"), /*#__PURE__*/React.createElement("span", {
      className: "db-meta"
    }, /*#__PURE__*/React.createElement(DIcon, {
      name: "shield-lock"
    }), " the file never leaves your device")),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DButton, {
      variant: "primary",
      leadingIcon: /*#__PURE__*/React.createElement(DIcon, {
        name: "upload"
      }),
      onClick: () => fileRef.current.click()
    }, "Open CSV"), data && /*#__PURE__*/React.createElement(DButton, {
      leadingIcon: /*#__PURE__*/React.createElement(DIcon, {
        name: "plus-lg"
      }),
      onClick: addCard
    }, "Add chart"), data && /*#__PURE__*/React.createElement(DIconButton, {
      label: "Close file",
      onClick: closeFile
    }, /*#__PURE__*/React.createElement(DIcon, {
      name: "x-lg"
    })))
  }), data ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "db-kpis"
  }, /*#__PURE__*/React.createElement(DStat, {
    label: "Rows",
    value: data.nrows().toLocaleString()
  }), /*#__PURE__*/React.createElement("span", {
    className: "db-kpis__div"
  }), /*#__PURE__*/React.createElement(DStat, {
    label: "Columns",
    value: headers.length
  }), /*#__PURE__*/React.createElement("span", {
    className: "db-kpis__div"
  }), /*#__PURE__*/React.createElement(DStat, {
    label: "Numeric",
    value: numericCount,
    tone: "accent"
  }), /*#__PURE__*/React.createElement("span", {
    className: "db-kpis__div"
  }), /*#__PURE__*/React.createElement(DStat, {
    label: "Distinct groups",
    value: distinctFirst,
    caption: headers[Math.max(0, kinds.indexOf("Text"))]
  }), /*#__PURE__*/React.createElement("span", {
    className: "db-kpis__spacer"
  }), /*#__PURE__*/React.createElement("span", {
    className: "db-kpis__file"
  }, /*#__PURE__*/React.createElement(DIcon, {
    name: "filetype-csv"
  }), " ", fileName)), cards.length ? /*#__PURE__*/React.createElement("div", {
    className: "db-grid"
  }, cards.map(c => /*#__PURE__*/React.createElement(ChartCard, {
    key: c.id,
    data: data,
    headers: headers,
    kinds: kinds,
    defaults: c,
    onRemove: () => removeCard(c.id)
  }))) : /*#__PURE__*/React.createElement("div", {
    className: "db-emptygrid"
  }, /*#__PURE__*/React.createElement(DEmpty, {
    glyph: /*#__PURE__*/React.createElement(DIcon, {
      name: "bar-chart",
      size: "1.8rem"
    }),
    lead: "No charts yet",
    description: "Add a chart to group and aggregate your data.",
    action: /*#__PURE__*/React.createElement(DButton, {
      variant: "primary",
      leadingIcon: /*#__PURE__*/React.createElement(DIcon, {
        name: "plus-lg"
      }),
      onClick: addCard
    }, "Add chart")
  }))) : /*#__PURE__*/React.createElement("div", {
    className: "db-emptyhost"
  }, /*#__PURE__*/React.createElement(DEmpty, {
    dropzone: true,
    over: over,
    glyph: /*#__PURE__*/React.createElement(DIcon, {
      name: "filetype-csv",
      size: "1.9rem"
    }),
    lead: "Open a CSV \u2014 it stays on your device.",
    description: "Grouping, aggregation and charting all happen in your browser. Nothing is uploaded.",
    action: /*#__PURE__*/React.createElement("div", {
      className: "db-empty-actions"
    }, /*#__PURE__*/React.createElement(DButton, {
      variant: "primary",
      leadingIcon: /*#__PURE__*/React.createElement(DIcon, {
        name: "upload"
      }),
      onClick: () => fileRef.current.click()
    }, "Open CSV"), /*#__PURE__*/React.createElement(DButton, {
      variant: "ghost",
      onClick: () => openCsv(SAMPLE_CSV, "customers.sample.csv")
    }, "Load sample data"))
  })), /*#__PURE__*/React.createElement("div", {
    className: "db-toasts"
  }, toasts.map(t => /*#__PURE__*/React.createElement(DToast, {
    key: t.id,
    tone: t.tone,
    title: t.title,
    description: t.description,
    onClose: () => setToasts(ts => ts.filter(x => x.id !== t.id))
  }))));
}
Object.assign(window, {
  EchartsDashboardApp
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/echarts-dashboard/EchartsDashboardApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/echarts-dashboard/aggregateEngine.js
try { (() => {
/* echarts-dashboard — pure aggregation engine stub + sample data.
   Mirrors dashboard-core + dashboard-wasm: WasmData.fromCsv → headers / kinds /
   nrows / numericCols / aggregate(category, measure, agg). Type-infers each
   column as Number | Text, groups by the category column, applies the
   aggregation (count · sum · avg · min · max) over the measure, and returns a
   Series { labels, values } sorted by value descending — feeding straight into
   an ECharts option. Count ignores the measure; non-numeric measure cells are
   skipped. No deps — the same engine the product compiles to wasm32. */

(function () {
  function parseCsv(text) {
    const rows = [];
    let row = [],
      field = "",
      q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else q = false;
        } else field += c;
      } else if (c === '"') q = true;else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(r => r.length > 1 || r.length === 1 && r[0] !== "");
  }
  const isNum = s => s !== "" && s != null && !Number.isNaN(Number(s));
  class WasmData {
    constructor(headers, kinds, rows) {
      this._headers = headers;
      this._kinds = kinds;
      this._rows = rows;
    }
    static fromCsv(text) {
      const grid = parseCsv(text);
      if (!grid.length) return new WasmData([], [], []);
      const headers = grid[0];
      const body = grid.slice(1);
      const kinds = headers.map((_, c) => {
        const vals = body.map(r => r[c]).filter(v => v !== "" && v != null);
        return vals.length && vals.every(isNum) ? "Number" : "Text";
      });
      return new WasmData(headers, kinds, body);
    }
    headers() {
      return this._headers.slice();
    }
    kinds() {
      return this._kinds.slice();
    }
    nrows() {
      return this._rows.length;
    }
    numericCols() {
      return this._kinds.map((k, i) => k === "Number" ? i : -1).filter(i => i >= 0);
    }
    distinct(category) {
      return new Set(this._rows.map(r => r[category])).size;
    }

    // agg ∈ "count"|"sum"|"avg"|"min"|"max"; measure = -1 for a plain count
    aggregate(category, measure, agg) {
      const groups = new Map();
      for (const r of this._rows) {
        const key = r[category] === "" || r[category] == null ? "∅" : String(r[category]);
        if (!groups.has(key)) groups.set(key, []);
        if (agg !== "count" && measure >= 0) {
          const n = Number(r[measure]);
          if (!Number.isNaN(n) && r[measure] !== "") groups.get(key).push(n);
        } else {
          groups.get(key).push(1);
        }
      }
      const pairs = [];
      for (const [key, arr] of groups) {
        let v = 0;
        if (agg === "count") v = arr.length;else if (!arr.length) v = 0;else if (agg === "sum") v = arr.reduce((a, b) => a + b, 0);else if (agg === "avg") v = arr.reduce((a, b) => a + b, 0) / arr.length;else if (agg === "min") v = Math.min(...arr);else if (agg === "max") v = Math.max(...arr);
        pairs.push([key, Math.round(v * 100) / 100]);
      }
      pairs.sort((a, b) => b[1] - a[1]);
      return {
        labels: pairs.map(p => p[0]),
        values: pairs.map(p => p[1])
      };
    }
  }

  // deterministic sample: SaaS customers — Text cols (region, plan, tier, channel)
  // make good group-bys; Number cols (seats, mrr, nps) make good measures.
  function sampleCsv() {
    const regions = ["NA", "EMEA", "APAC", "LATAM"];
    const plans = ["Free", "Pro", "Team", "Enterprise"];
    const channels = ["Organic", "Referral", "Paid", "Partner"];
    const seatsBy = {
      Free: [1, 3],
      Pro: [2, 12],
      Team: [8, 40],
      Enterprise: [40, 320]
    };
    const mrrPer = {
      Free: 0,
      Pro: 12,
      Team: 9,
      Enterprise: 7.5
    };
    let rng = 4242;
    const rand = () => (rng = rng * 1103515245 + 12345 & 0x7fffffff) / 0x7fffffff;
    const rows = [["id", "region", "plan", "channel", "seats", "mrr", "nps"]];
    for (let i = 0; i < 120; i++) {
      const plan = plans[Math.floor(rand() * plans.length)];
      const [lo, hi] = seatsBy[plan];
      const seats = Math.floor(lo + rand() * (hi - lo));
      const mrr = (seats * mrrPer[plan] * (0.9 + rand() * 0.2)).toFixed(2);
      const region = regions[Math.floor(rand() * regions.length)];
      const channel = channels[Math.floor(rand() * channels.length)];
      const nps = Math.floor(10 + rand() * 80);
      rows.push([2001 + i, region, plan, channel, seats, mrr, nps]);
    }
    return rows.map(r => r.join(",")).join("\n");
  }
  window.DatacoreDashboard = {
    WasmData,
    parseCsv,
    SAMPLE_CSV: sampleCsv()
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/echarts-dashboard/aggregateEngine.js", error: String((e && e.message) || e) }); }

// ui_kits/rbac-explorer/RbacExplorerApp.jsx
try { (() => {
/* RbacExplorerApp — the orchestrator. Holds the membership state (actor → set of
   node ids) and rebuilds reach on every change by calling the engine
   (WasmGraph.reachable). EXPLORE mode: pick an actor, click nodes to grant/revoke,
   watch the subtree light up. REVERSE mode: click a node to see who can reach it.
   The graph structure is fixed, so the WasmGraph is built once. Composes the
   Datacore primitives. */

const RB = window.DatacoreDesignSystem_a460c7;
const RE = window.DatacoreRbac;
const {
  Toolbar: RToolbar,
  Select: RSelect,
  Tabs: RTabs,
  Button: RButton,
  Badge: RBadge,
  Toast: RToast,
  Icon: RIcon,
  Tooltip: RTooltip
} = RB;
const {
  WasmGraph,
  NODES,
  ACTORS
} = RE;
const {
  useState,
  useMemo,
  useRef
} = React;
function RbacExplorerApp() {
  // clone the seed memberships into mutable state
  const [members, setMembers] = useState(() => {
    const m = {};
    ACTORS.forEach(a => m[a.name] = new Set(a.members));
    return m;
  });
  const [actorName, setActorName] = useState("Bob");
  const [mode, setMode] = useState("explore");
  const [reverseTarget, setReverseTarget] = useState(null);
  const [toasts, setToasts] = useState([]);

  // the graph structure never changes → build the engine handle once
  const graph = useRef(null);
  if (!graph.current) graph.current = new WasmGraph(NODES.map(n => n.id), NODES.map(n => n.parent));

  // present the selected actor with their LIVE memberships
  const actor = useMemo(() => {
    const base = ACTORS.find(a => a.name === actorName);
    return {
      ...base,
      members: [...(members[actorName] || [])]
    };
  }, [actorName, members]);
  const reach = useMemo(() => new Set(graph.current.reachable([...(members[actorName] || [])])), [members, actorName]);
  const childrenOf = pid => NODES.filter(n => n.parent === pid);
  const membersAt = id => ACTORS.map(a => ({
    ...a,
    members: [...(members[a.name] || [])]
  })).filter(a => a.members.includes(id));
  const labelOf = id => (NODES.find(n => n.id === id) || {}).label || id;

  // reverse lookup: which actors' reach includes the target, and via which membership
  const reverseActors = useMemo(() => {
    if (mode !== "reverse" || !reverseTarget) return [];
    const out = [];
    for (const a of ACTORS) {
      const mem = [...(members[a.name] || [])];
      const r = new Set(graph.current.reachable(mem));
      if (r.has(reverseTarget)) {
        // find the specific membership whose subtree contains the target
        const via = mem.find(m => new Set(graph.current.reachable([m])).has(reverseTarget));
        out.push({
          actor: a,
          via
        });
      }
    }
    return out;
  }, [mode, reverseTarget, members]);
  function pushToast(t) {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, {
      id,
      ...t
    }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3200);
  }
  function onNodeClick(id) {
    if (mode === "reverse") {
      setReverseTarget(id);
      return;
    }
    // grant / revoke
    setMembers(cur => {
      const next = {
        ...cur,
        [actorName]: new Set(cur[actorName])
      };
      const had = next[actorName].has(id);
      had ? next[actorName].delete(id) : next[actorName].add(id);
      const granted = !had;
      const sub = graph.current.reachable([id]).length;
      pushToast({
        tone: granted ? "success" : "info",
        title: `${granted ? "Granted" : "Revoked"} ${actorName} · ${labelOf(id)}`,
        description: granted ? `+${sub} node${sub === 1 ? "" : "s"} reachable (subtree)` : "membership removed"
      });
      return next;
    });
  }
  function resetMemberships() {
    const m = {};
    ACTORS.forEach(a => m[a.name] = new Set(a.members));
    setMembers(m);
    pushToast({
      tone: "info",
      title: "Memberships reset",
      description: "back to the sample org"
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "rb-app"
  }, /*#__PURE__*/React.createElement(RToolbar, {
    sticky: true,
    left: /*#__PURE__*/React.createElement("div", {
      className: "rb-brand"
    }, /*#__PURE__*/React.createElement("span", {
      className: "rb-logo",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("h1", {
      className: "rb-title"
    }, "rbac-explorer"), /*#__PURE__*/React.createElement("span", {
      className: "rb-meta"
    }, "scoped ownership \xB7 reach descends, never climbs")),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(RTabs, {
      variant: "segmented",
      value: mode,
      onChange: m => {
        setMode(m);
        setReverseTarget(null);
      },
      tabs: [{
        id: "explore",
        label: "Explore",
        icon: /*#__PURE__*/React.createElement(RIcon, {
          name: "diagram-3"
        })
      }, {
        id: "reverse",
        label: "Reverse",
        icon: /*#__PURE__*/React.createElement(RIcon, {
          name: "search"
        })
      }]
    }), /*#__PURE__*/React.createElement(RButton, {
      variant: "ghost",
      leadingIcon: /*#__PURE__*/React.createElement(RIcon, {
        name: "arrow-counterclockwise"
      }),
      onClick: resetMemberships
    }, "Reset"))
  }), /*#__PURE__*/React.createElement("div", {
    className: "rb-legend"
  }, mode === "explore" ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
    className: "rb-actorpick"
  }, /*#__PURE__*/React.createElement("span", null, "Actor"), /*#__PURE__*/React.createElement(RSelect, {
    size: "sm",
    value: actorName,
    onChange: e => setActorName(e.target.value),
    options: ACTORS.map(a => ({
      value: a.name,
      label: a.name
    }))
  })), /*#__PURE__*/React.createElement("span", {
    className: "rb-legend__spacer"
  }), /*#__PURE__*/React.createElement("span", {
    className: "rb-key"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rb-swatch is-member"
  }), " direct membership"), /*#__PURE__*/React.createElement("span", {
    className: "rb-key"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rb-swatch is-reached"
  }), " reachable (subtree)"), /*#__PURE__*/React.createElement("span", {
    className: "rb-key"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rb-swatch is-dim"
  }), " no access")) : /*#__PURE__*/React.createElement("span", {
    className: "rb-legend__note"
  }, /*#__PURE__*/React.createElement(RIcon, {
    name: "info-circle"
  }), " Click any node to see ", /*#__PURE__*/React.createElement("b", null, "who can reach it"), " and via which membership.")), /*#__PURE__*/React.createElement("main", {
    className: "rb-main"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rb-treehost"
  }, /*#__PURE__*/React.createElement(RbacTree, {
    nodes: NODES,
    childrenOf: childrenOf,
    membersAt: membersAt,
    actor: mode === "explore" ? actor : null,
    reach: mode === "explore" ? reach : new Set(),
    mode: mode,
    reverseTarget: reverseTarget,
    onNodeClick: onNodeClick
  })), /*#__PURE__*/React.createElement("aside", {
    className: "rb-aside"
  }, /*#__PURE__*/React.createElement(ReachPanel, {
    mode: mode,
    actor: actor,
    nodes: NODES,
    reach: reach,
    labelOf: labelOf,
    reverseTarget: reverseTarget,
    reverseActors: reverseActors
  }))), /*#__PURE__*/React.createElement("div", {
    className: "rb-toasts"
  }, toasts.map(t => /*#__PURE__*/React.createElement(RToast, {
    key: t.id,
    tone: t.tone,
    title: t.title,
    description: t.description,
    onClose: () => setToasts(ts => ts.filter(x => x.id !== t.id))
  }))));
}
Object.assign(window, {
  RbacExplorerApp
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rbac-explorer/RbacExplorerApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rbac-explorer/RbacTree.jsx
try { (() => {
/* RbacTree — the org scope tree, rendered as a nested/indented tree with dashed
   connector rails. Each node carries its kind icon, a label, and member-avatar
   badges (the selected actor emphasized). Node state reflects the current reach:
   `member` (accent inset ring), `reached` (green tint), or `dim` (no access).
   Clicking a node grants/revokes the selected actor's membership there. In
   reverse-lookup mode, clicking selects the target node instead. Composes
   Avatar + Icon + Tooltip. */

const {
  Avatar: TreeAvatar,
  Icon: TreeIcon,
  Tooltip: TreeTooltip
} = window.DatacoreDesignSystem_a460c7;
const {
  KIND_ICON
} = window.DatacoreRbac;
function TreeNode({
  node,
  childrenOf,
  membersAt,
  actor,
  reach,
  mode,
  reverseTarget,
  onNodeClick
}) {
  const isMember = actor && actor.members.includes(node.id);
  const reached = reach.has(node.id);
  const members = membersAt(node.id);
  const kids = childrenOf(node.id);
  const isTarget = reverseTarget === node.id;
  const cls = ["rb-node", mode === "explore" && (reached ? "is-reached" : "is-dim"), mode === "explore" && isMember && "is-member", mode === "reverse" && isTarget && "is-target"].filter(Boolean).join(" ");
  const title = mode === "explore" ? `Click to ${isMember ? "revoke" : "grant"} ${actor ? actor.name : ""}'s membership here` : "Click: who can reach this node?";
  return /*#__PURE__*/React.createElement("div", {
    className: "rb-branch"
  }, /*#__PURE__*/React.createElement(TreeTooltip, {
    content: title,
    placement: "right"
  }, /*#__PURE__*/React.createElement("button", {
    className: cls,
    "data-id": node.id,
    onClick: () => onNodeClick(node.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "rb-node__icon"
  }, /*#__PURE__*/React.createElement(TreeIcon, {
    name: KIND_ICON[node.kind] || "dot"
  })), /*#__PURE__*/React.createElement("span", {
    className: "rb-node__label"
  }, node.label), /*#__PURE__*/React.createElement("span", {
    className: "rb-node__kind"
  }, node.kind), /*#__PURE__*/React.createElement("span", {
    className: "rb-node__spacer"
  }), reached && mode === "explore" && /*#__PURE__*/React.createElement("span", {
    className: "rb-node__reach"
  }, /*#__PURE__*/React.createElement(TreeIcon, {
    name: "check-circle-fill"
  })), /*#__PURE__*/React.createElement("span", {
    className: "rb-node__badges"
  }, members.map(a => /*#__PURE__*/React.createElement(Avatar2, {
    key: a.name,
    actor: a,
    me: actor && a.name === actor.name
  }))))), kids.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "rb-children"
  }, kids.map(k => /*#__PURE__*/React.createElement(TreeNode, {
    key: k.id,
    node: k,
    childrenOf: childrenOf,
    membersAt: membersAt,
    actor: actor,
    reach: reach,
    mode: mode,
    reverseTarget: reverseTarget,
    onNodeClick: onNodeClick
  }))));
}
function Avatar2({
  actor,
  me
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "rb-badge" + (me ? " is-me" : ""),
    title: actor.name
  }, actor.name[0]);
}
function RbacTree({
  nodes,
  childrenOf,
  membersAt,
  actor,
  reach,
  mode,
  reverseTarget,
  onNodeClick
}) {
  const roots = nodes.filter(n => !n.parent);
  return /*#__PURE__*/React.createElement("div", {
    className: "rb-tree"
  }, roots.map(n => /*#__PURE__*/React.createElement(TreeNode, {
    key: n.id,
    node: n,
    childrenOf: childrenOf,
    membersAt: membersAt,
    actor: actor,
    reach: reach,
    mode: mode,
    reverseTarget: reverseTarget,
    onNodeClick: onNodeClick
  })));
}
Object.assign(window, {
  RbacTree
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rbac-explorer/RbacTree.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rbac-explorer/ReachPanel.jsx
try { (() => {
/* ReachPanel — the side panel. In EXPLORE mode it summarizes the selected actor:
   a big "reaches N of M" Stat, their direct memberships, and the full reachable
   set. In REVERSE mode it answers "who can reach this node?" — listing every
   actor whose memberships descend onto the target, and via which membership.
   Composes Stat + Badge + Avatar + Icon + Code. */

const {
  Stat: PanelStat,
  Badge: PanelBadge,
  Avatar: PanelAvatar,
  Icon: PanelIcon,
  Code: PanelCode
} = window.DatacoreDesignSystem_a460c7;
function ReachPanel({
  mode,
  actor,
  nodes,
  reach,
  labelOf,
  reverseTarget,
  reverseActors,
  onClearReverse
}) {
  if (mode === "reverse") {
    const target = reverseTarget ? nodes.find(n => n.id === reverseTarget) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "rb-panel"
    }, /*#__PURE__*/React.createElement("div", {
      className: "rb-panel__head"
    }, /*#__PURE__*/React.createElement(PanelIcon, {
      name: "search"
    }), " ", /*#__PURE__*/React.createElement("span", null, "Reverse lookup")), !target ? /*#__PURE__*/React.createElement("p", {
      className: "rb-panel__hint"
    }, "Click any node in the tree to see ", /*#__PURE__*/React.createElement("b", null, "who can reach it"), ".") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PanelStat, {
      tone: "accent",
      label: "Who can reach",
      value: reverseActors.length,
      unit: `/ ${actorCount(reverseActors, nodes)}`,
      caption: target.label
    }), /*#__PURE__*/React.createElement("div", {
      className: "rb-panel__sec"
    }, "target node"), /*#__PURE__*/React.createElement("div", {
      className: "rb-panel__target"
    }, /*#__PURE__*/React.createElement(PanelBadge, {
      tone: "neutral",
      square: true
    }, target.kind), /*#__PURE__*/React.createElement("b", null, target.label)), /*#__PURE__*/React.createElement("div", {
      className: "rb-panel__sec"
    }, "reachable by"), /*#__PURE__*/React.createElement("ul", {
      className: "rb-who"
    }, reverseActors.length === 0 && /*#__PURE__*/React.createElement("li", {
      className: "rb-panel__hint"
    }, "No actor can reach this node."), reverseActors.map(r => /*#__PURE__*/React.createElement("li", {
      key: r.actor.name,
      className: "rb-who__row"
    }, /*#__PURE__*/React.createElement(PanelAvatar, {
      size: "sm",
      name: r.actor.name,
      tone: r.actor.role === "admin" ? "var(--accent)" : "var(--text-muted)"
    }), /*#__PURE__*/React.createElement("span", {
      className: "rb-who__name"
    }, r.actor.name), /*#__PURE__*/React.createElement("span", {
      className: "rb-who__via"
    }, "via ", /*#__PURE__*/React.createElement(PanelCode, {
      tone: "muted"
    }, labelOf(r.via))))))));
  }

  // explore mode
  const reachable = nodes.filter(n => reach.has(n.id));
  const members = actor ? actor.members : [];
  return /*#__PURE__*/React.createElement("div", {
    className: "rb-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rb-panel__head"
  }, /*#__PURE__*/React.createElement(PanelAvatar, {
    size: "sm",
    name: actor ? actor.name : "",
    tone: actor && actor.role === "admin" ? "var(--accent)" : "var(--text-muted)"
  }), /*#__PURE__*/React.createElement("span", null, actor ? actor.name : "—"), actor && /*#__PURE__*/React.createElement(PanelBadge, {
    tone: actor.role === "admin" ? "accent" : "neutral",
    square: true
  }, actor.role)), /*#__PURE__*/React.createElement(PanelStat, {
    tone: "success",
    label: "Reaches",
    value: reachable.length,
    unit: `/ ${nodes.length}`,
    caption: "nodes in the org"
  }), /*#__PURE__*/React.createElement("div", {
    className: "rb-panel__sec"
  }, "member of"), /*#__PURE__*/React.createElement("div", {
    className: "rb-chips"
  }, members.length === 0 && /*#__PURE__*/React.createElement("span", {
    className: "rb-panel__hint"
  }, "nothing"), members.map(id => /*#__PURE__*/React.createElement("span", {
    key: id,
    className: "rb-chip is-member"
  }, /*#__PURE__*/React.createElement(PanelIcon, {
    name: "dot"
  }), " ", labelOf(id)))), /*#__PURE__*/React.createElement("div", {
    className: "rb-panel__sec"
  }, "reaches"), /*#__PURE__*/React.createElement("div", {
    className: "rb-chips"
  }, reachable.length === 0 && /*#__PURE__*/React.createElement("span", {
    className: "rb-panel__hint"
  }, "nothing"), reachable.map(n => /*#__PURE__*/React.createElement("span", {
    key: n.id,
    className: "rb-chip" + (members.includes(n.id) ? " is-member" : " is-reached")
  }, n.label))));
}
function actorCount(_, __) {
  // total actors is supplied via reverseActors' closure caller; kept simple here
  return window.DatacoreRbac.ACTORS.length;
}
Object.assign(window, {
  ReachPanel
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rbac-explorer/ReachPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rbac-explorer/rbacEngine.js
try { (() => {
/* rbac-explorer — pure reach engine stub + sample org.
   Mirrors crates/core + rbac-wasm: WasmGraph(ids, parents) with reachable(seed).
   The rule: reachable(actor) = ⋃ over each membership node of that node's SUBTREE
   (the node itself + everything scoped beneath it) — reach DESCENDS, never climbs
   to the parent or siblings. Depth-first, cycle-safe (visited guard) so even a
   malformed graph terminates. No deps — the same rule the build-engine enforces
   server-side as a recursive SQL CTE. */

(function () {
  class WasmGraph {
    // ids: string[]; parents: string[]  (parents[i] = "" for a root)
    constructor(ids, parents) {
      this._ids = ids.slice();
      this._children = new Map(ids.map(id => [id, []]));
      ids.forEach((id, i) => {
        const p = parents[i];
        if (p && this._children.has(p)) this._children.get(p).push(id);
      });
    }
    // descends from each seed node, collecting the subtree; includes the seed
    reachable(seed) {
      const out = new Set();
      const stack = [...seed];
      while (stack.length) {
        const id = stack.pop();
        if (out.has(id)) continue; // cycle / re-visit guard
        out.add(id);
        const kids = this._children.get(id);
        if (kids) for (const k of kids) stack.push(k);
      }
      return [...out];
    }
  }

  // sample org: Company → Department → Project/Team → Service. Deep enough that
  // granting a membership on a parent visibly lights a multi-level subtree.
  const NODES = [{
    id: "acme",
    label: "Acme Corp",
    kind: "Company",
    parent: ""
  }, {
    id: "eng",
    label: "Engineering",
    kind: "Department",
    parent: "acme"
  }, {
    id: "apollo",
    label: "Project Apollo",
    kind: "Project",
    parent: "eng"
  }, {
    id: "apollo-api",
    label: "Apollo API",
    kind: "Service",
    parent: "apollo"
  }, {
    id: "apollo-web",
    label: "Apollo Web",
    kind: "Service",
    parent: "apollo"
  }, {
    id: "zephyr",
    label: "Project Zephyr",
    kind: "Project",
    parent: "eng"
  }, {
    id: "platform",
    label: "Platform",
    kind: "Project",
    parent: "eng"
  }, {
    id: "sales",
    label: "Sales",
    kind: "Department",
    parent: "acme"
  }, {
    id: "eu",
    label: "Region EU",
    kind: "Team",
    parent: "sales"
  }, {
    id: "us",
    label: "Region US",
    kind: "Team",
    parent: "sales"
  }, {
    id: "design",
    label: "Design",
    kind: "Department",
    parent: "acme"
  }, {
    id: "brand",
    label: "Brand Studio",
    kind: "Team",
    parent: "design"
  }];

  // actor → set of node ids (direct memberships). Labels/kinds & this state live
  // only in the UI; the engine needs nothing but ids + parent edges.
  const ACTORS = [{
    name: "Alice",
    role: "admin",
    members: ["acme"]
  },
  // company-wide
  {
    name: "Bob",
    role: "admin",
    members: ["eng"]
  },
  // all engineering
  {
    name: "Carol",
    role: "viewer",
    members: ["apollo"]
  },
  // one project (+ its services)
  {
    name: "Dave",
    role: "viewer",
    members: ["sales"]
  },
  // sales
  {
    name: "Erin",
    role: "viewer",
    members: []
  },
  // nothing
  {
    name: "Frank",
    role: "viewer",
    members: ["platform", "brand"]
  } // two leaves
  ];
  const KIND_ICON = {
    Company: "building",
    Department: "diagram-3",
    Project: "folder",
    Team: "people",
    Service: "box"
  };
  window.DatacoreRbac = {
    WasmGraph,
    NODES,
    ACTORS,
    KIND_ICON
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rbac-explorer/rbacEngine.js", error: String((e && e.message) || e) }); }

__ds_ns.Chart = __ds_scope.Chart;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Code = __ds_scope.Code;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.KindLabel = __ds_scope.KindLabel;

__ds_ns.Stat = __ds_scope.Stat;

__ds_ns.Toolbar = __ds_scope.Toolbar;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Tabs = __ds_scope.Tabs;

})();

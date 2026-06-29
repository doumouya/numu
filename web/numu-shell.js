/* numu-shell.js — the shared app shell: ONE source of truth for theme tokens,
   the theme engine, the workspace/page registries, and the cross-page resolvers.
   Loaded like numu-charts.js (plain <script> in <helmet>); sets window.NUMU_SHELL.

   Pages stop carrying their own copies of TONES/STATUS/CHART/buildVars/applyTheme
   and the workspace + mode-tab arrays — they read them from here. Change a token
   or add a page in ONE place and all three surfaces move together. */
(function () {
  // ---- neutral substrate (4 switchable tones × light/dark) ----------------
  var TONES = {
    slate: {
      light: { "--surface": "#ffffff", "--surface-subtle": "#f7f9fb", "--surface-sunken": "#eff3f8", "--surface-overlay": "#ffffff", "--text": "#1e293b", "--text-muted": "#5b677a", "--text-subtle": "#94a3b8", "--border": "#e3e8ef", "--border-strong": "#cbd5e1", "--border-subtle": "#eef2f7" },
      dark:  { "--surface": "#0f1729", "--surface-subtle": "#18223a", "--surface-sunken": "#0b1120", "--surface-overlay": "#1c2740", "--text": "#e7ecf3", "--text-muted": "#99a4b6", "--text-subtle": "#6e7a8d", "--border": "#283349", "--border-strong": "#3a4763", "--border-subtle": "#1a2336" }
    },
    graphite: {
      light: { "--surface": "#ffffff", "--surface-subtle": "#f6f6f7", "--surface-sunken": "#eeeef0", "--surface-overlay": "#ffffff", "--text": "#1f2023", "--text-muted": "#61636a", "--text-subtle": "#9a9ca2", "--border": "#e5e5e8", "--border-strong": "#cccdd2", "--border-subtle": "#f0f0f1" },
      dark:  { "--surface": "#16181c", "--surface-subtle": "#1e2025", "--surface-sunken": "#101114", "--surface-overlay": "#24262c", "--text": "#eaebed", "--text-muted": "#9b9da3", "--text-subtle": "#6f7177", "--border": "#2c2e34", "--border-strong": "#3d3f47", "--border-subtle": "#1a1c20" }
    },
    carbon: {
      light: { "--surface": "#ffffff", "--surface-subtle": "#f4f4f5", "--surface-sunken": "#ebebec", "--surface-overlay": "#ffffff", "--text": "#18181a", "--text-muted": "#5c5c61", "--text-subtle": "#909096", "--border": "#e4e4e6", "--border-strong": "#c9c9cc", "--border-subtle": "#efeff0" },
      dark:  { "--surface": "#0c0c0e", "--surface-subtle": "#151517", "--surface-sunken": "#070708", "--surface-overlay": "#1b1b1e", "--text": "#f1f1f2", "--text-muted": "#97979c", "--text-subtle": "#6a6a6f", "--border": "#252528", "--border-strong": "#37373b", "--border-subtle": "#151517" }
    },
    sandstone: {
      light: { "--surface": "#fffdfb", "--surface-subtle": "#f7f3ee", "--surface-sunken": "#efe9e1", "--surface-overlay": "#fffdfb", "--text": "#292320", "--text-muted": "#6c6258", "--text-subtle": "#a69b8e", "--border": "#e9e2d8", "--border-strong": "#d4cabc", "--border-subtle": "#f2ece4" },
      dark:  { "--surface": "#1a1613", "--surface-subtle": "#221d19", "--surface-sunken": "#120f0c", "--surface-overlay": "#29231e", "--text": "#efe9e1", "--text-muted": "#a89d90", "--text-subtle": "#786e62", "--border": "#332c26", "--border-strong": "#473e35", "--border-subtle": "#1d1916" }
    }
  };
  var TONE_META = [
    { id: "slate", name: "Slate", desc: "cool", swatch: "#0f1729" },
    { id: "graphite", name: "Graphite", desc: "neutral", swatch: "#16181c" },
    { id: "carbon", name: "Carbon", desc: "near-black", swatch: "#0c0c0e" },
    { id: "sandstone", name: "Sandstone", desc: "warm", swatch: "#1a1613" }
  ];
  // ---- status + chart palettes (theme-mapped) -----------------------------
  var STATUS = {
    light: { "--success": "#2f9255", "--success-tint": "#eaf5ee", "--warning": "#b07d18", "--warning-tint": "#f7f0df", "--danger": "#be3b32", "--danger-tint": "#fbece9", "--status-backlog": "#64748b", "--status-progress": "#3f5573", "--status-review": "#b07d18", "--status-done": "#2f9255" },
    dark:  { "--success": "#62c585", "--success-tint": "color-mix(in srgb, #62c585 16%, transparent)", "--warning": "#e0b257", "--warning-tint": "color-mix(in srgb, #e0b257 16%, transparent)", "--danger": "#ef8079", "--danger-tint": "color-mix(in srgb, #ef8079 16%, transparent)", "--status-backlog": "#94a3b8", "--status-progress": "#8aa4c8", "--status-review": "#e0b257", "--status-done": "#62c585" }
  };
  var CHART = {
    light: { "--chart-2": "#5b6cb0", "--chart-3": "#2a8aa0", "--chart-4": "#2f9255", "--chart-5": "#b07d18", "--chart-6": "#be3b32", "--chart-7": "#9a5a9e", "--chart-8": "#64748b" },
    dark:  { "--chart-2": "#93a0e0", "--chart-3": "#4cb6cc", "--chart-4": "#62c585", "--chart-5": "#e0b257", "--chart-6": "#ef8079", "--chart-7": "#c98fce", "--chart-8": "#94a3b8" }
  };
  // ---- per-tenant accents (one accent per app, light + dark) ---------------
  var ACCENTS = {
    light: { platform: "#3f5573", studio: "#b13c5f", commerce: "#9a6518", social: "#2a7d63" },
    dark:  { platform: "#8aa4c8", studio: "#e895af", commerce: "#dfa856", social: "#5cc8a0" }
  };
  var SECONDARY_ACCENT = "#5b6cb0";

  // ---- registries: workspaces (apps) + pages (modes) ----------------------
  // Add an app or a page = ONE entry here; rail, mode-tabs and routing follow.
  var TENANTS = {
    platform: { mark: "nu", name: "numu", sub: "operator console", short: "steel" },
    studio:   { mark: "OR", name: "ORVCLE Studio", sub: "music · label", short: "rose" },
    commerce: { mark: "MR", name: "Maison Réts", sub: "clothing · commerce", short: "ochre" },
    social:   { mark: "KS", name: "Kestrel", sub: "creator · social", short: "emerald" }
  };
  var WORKSPACES = ["platform", "studio", "commerce", "social"].map(function (id) {
    return { id: id, mark: TENANTS[id].mark, name: TENANTS[id].name, accent: ACCENTS.light[id] };
  });
  var PAGES = [
    { id: "chat",      mode: "chat",      label: "Chat",      labelFr: "Discussion",      icon: "chat-text", href: "numu Console.dc.html", built: true },
    { id: "explore",   mode: "explore",   label: "Explore",   labelFr: "Explorer",        icon: "terminal",  href: "numu Console.dc.html", built: true },
    { id: "dashboard", mode: "dashboard", label: "Dashboard", labelFr: "Tableau de bord", icon: "grid-1x2",  href: "numu Console.dc.html", built: true }
  ];
  var ME = { initials: "JM", name: "Jordan", role: "builder · operator" };

  // ---- theme engine (defined once) ----------------------------------------
  // opts: { tenant, theme, tone, accent?, secondaryAccent? }
  function buildVars(opts) {
    opts = opts || {};
    var theme = opts.theme === "dark" ? "dark" : "light";
    var tone = TONES[opts.tone] ? opts.tone : "slate";
    var tenant = TENANTS[opts.tenant] ? opts.tenant : "platform";
    var light = theme === "light";
    var base = Object.assign({}, TONES[tone][theme], STATUS[theme], CHART[theme]);
    // chart grid/track/tooltip ride the chosen surface tone
    base["--chart-grid"] = base["--border"]; base["--chart-track"] = base["--surface-sunken"]; base["--chart-axis"] = base["--text-muted"];
    base["--chart-tooltip-bg"] = base["--surface-overlay"]; base["--chart-tooltip-border"] = base["--border"]; base["--chart-tooltip-text"] = base["--text"];
    var acc = opts.accent || ACCENTS[theme][tenant] || ACCENTS[theme].platform;
    var secB = opts.secondaryAccent || SECONDARY_ACCENT;
    var sec = light ? secB : "color-mix(in srgb, " + secB + " 62%, #ffffff)";
    var hover = light ? "color-mix(in srgb, " + acc + " 84%, #000)" : "color-mix(in srgb, " + acc + " 82%, #fff)";
    var tint = light ? "color-mix(in srgb, " + acc + " 9%, #fff)" : "color-mix(in srgb, " + acc + " 16%, transparent)";
    return Object.assign(base, {
      "--accent": acc, "--accent-hover": hover, "--accent-tint": tint, "--accent-border": acc,
      "--focus": acc, "--focus-ring": "2px solid " + acc, "--text-on-accent": light ? "#ffffff" : "#0b1120",
      "--accent-2": sec, "--selection-bg": "color-mix(in srgb, " + acc + " 20%, transparent)", "--chart-1": acc
    });
  }
  function applyTheme(rootEl, opts) {
    if (!rootEl) return;
    var v = buildVars(opts);
    for (var k in v) rootEl.style.setProperty(k, v[k]);
    rootEl.style.colorScheme = (opts && opts.theme === "dark") ? "dark" : "light";
  }
  // echarts theme hexes (anchored on the active accent)
  function themeHexes(opts) {
    opts = opts || {};
    var theme = opts.theme === "dark" ? "dark" : "light";
    var tone = TONES[opts.tone] ? opts.tone : "slate";
    var tenant = TENANTS[opts.tenant] ? opts.tenant : "platform";
    var N = TONES[tone][theme], C = CHART[theme];
    var acc = opts.accent || ACCENTS[theme][tenant] || ACCENTS[theme].platform;
    return {
      color: [acc, C["--chart-2"], C["--chart-3"], C["--chart-4"], C["--chart-5"], C["--chart-6"], C["--chart-7"], C["--chart-8"]],
      text: N["--text"], textMuted: N["--text-muted"], textSubtle: N["--text-subtle"], border: N["--border"],
      surface: N["--surface"], tooltipBg: N["--surface-overlay"], tooltipBorder: N["--border"]
    };
  }
  function toneName(id) { var m = TONE_META.find(function (x) { return x.id === id; }); return m ? m.name : "Slate"; }

  // ---- cross-page resolvers (localStorage is authoritative) ---------------
  function lsGet(k) { try { return localStorage.getItem(k) || undefined; } catch (e) { return undefined; } }
  function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // resolve(stateVal, lsKey, propVal, fallback): state → storage → prop → default
  function resolve(stateVal, lsKey, propVal, fallback) {
    return (stateVal != null ? stateVal : undefined) ?? lsGet(lsKey) ?? (propVal != null ? propVal : undefined) ?? fallback;
  }

  // ---- mode tabs built from PAGES -----------------------------------------
  // modeTabs(activeMode, navigate, lang): navigate(href) is the page's router.
  function modeTabs(activeMode, navigate, lang) {
    return PAGES.map(function (p) {
      return {
        id: p.id, icon: p.icon,
        label: (lang === "fr" ? p.labelFr : p.label),
        title: (lang === "fr" ? p.labelFr : p.label),
        active: p.mode === activeMode,
        onClick: function () { if (p.mode !== activeMode) navigate(p.href); }
      };
    });
  }
  function workspaces(activeTenant, onPick, theme) {
    var t = theme === "dark" ? "dark" : "light";
    return WORKSPACES.map(function (w) {
      return { id: w.id, mark: w.mark, name: w.name, accent: ACCENTS[t][w.id] || w.accent, active: w.id === activeTenant, onClick: function () { onPick(w.id); } };
    });
  }

  // ---- nacl keyword skins — canonical IR ⇄ localized verbs (one source of truth) ----
  // The data page's kw() and the Console nacl-dialect editor both read these, so a
  // verb is named in ONE place. A custom dialect layers user words over a skin.
  var NACL_LEX = {
    en: { open:"open", filter:"filter", group:"group", sort:"sort", last:"last", join:"join", datetime:"datetime", post:"post", clean:"clean", recode:"recode", cast:"cast", rename:"rename", repair:"repair", validate:"validate", dedupe:"dedupe", fill:"fill", unwrap:"unwrap", drop:"drop", keep:"keep", snake:"snake", case:"case", replace:"replace", concat:"concat", split:"split", dates:"dates", chart:"chart", pivot:"pivot", by:"by", on:"on", desc:"desc", asc:"asc" },
    fr: { open:"ouvre", filter:"filtre", group:"groupe", sort:"trie", last:"derniers", join:"relie", datetime:"horodate", post:"envoie", clean:"nettoie", recode:"recode", cast:"convertis", rename:"renomme", repair:"répare", validate:"valide", dedupe:"dédoublonne", fill:"remplis", unwrap:"déplie", drop:"supprime", keep:"garde", snake:"snake", case:"casse", replace:"remplace", concat:"concatène", split:"découpe", dates:"dates", chart:"graphique", pivot:"pivot", by:"par", on:"sur", desc:"décroissant", asc:"croissant" }
  };
  // canonical verbs in editor order — drives the custom-dialect editor
  var NACL_VERBS = [
    { canon:"open", group:"read", desc:"load a source" },
    { canon:"filter", group:"read", desc:"keep matching rows" },
    { canon:"sort", group:"read", desc:"order rows" },
    { canon:"group", group:"read", desc:"aggregate by column" },
    { canon:"last", group:"read", desc:"newest n" },
    { canon:"join", group:"read", desc:"inner join" },
    { canon:"datetime", group:"read", desc:"parse to datetime" },
    { canon:"unwrap", group:"read", desc:"split wrapped CSV" },
    { canon:"chart", group:"visualize", desc:"chart it" },
    { canon:"pivot", group:"visualize", desc:"pivot table" },
    { canon:"clean", group:"clean", desc:"sentinels → null" },
    { canon:"cast", group:"clean", desc:"change type" },
    { canon:"rename", group:"clean", desc:"rename column" },
    { canon:"recode", group:"clean", desc:"swap a value" },
    { canon:"replace", group:"clean", desc:"replace text" },
    { canon:"repair", group:"clean", desc:"fix encoding" },
    { canon:"fill", group:"clean", desc:"fill nulls" },
    { canon:"drop", group:"clean", desc:"drop nulls / columns" },
    { canon:"keep", group:"clean", desc:"keep columns" },
    { canon:"case", group:"clean", desc:"upper / lower" },
    { canon:"concat", group:"clean", desc:"join columns" },
    { canon:"split", group:"clean", desc:"split column" },
    { canon:"dates", group:"clean", desc:"format dates" },
    { canon:"validate", group:"clean", desc:"flag bad values" },
    { canon:"dedupe", group:"clean", desc:"distinct rows" },
    { canon:"post", group:"export", desc:"emit result" }
  ];
  function naclSkin(lang){ return NACL_LEX[lang] ? lang : "en"; }
  function naclCustomParse(raw){ if(!raw) return {}; try{ var o=JSON.parse(raw); return (o && typeof o==="object") ? o : {}; }catch(e){ return {}; } }
  // canonical verb → the word to SHOW (custom override wins over the skin)
  function naclKw(canon, lang, custom){ var l=NACL_LEX[naclSkin(lang)]; var cu=custom||{}; return (cu[canon]!=null && cu[canon]!=="") ? cu[canon] : (l[canon]||canon); }
  // any localized/custom word → its canonical key (for the parser); null if unknown
  function naclCanon(word, custom){
    if(!word) return null;
    var w=String(word).toLowerCase();
    if(custom){ for(var k in custom){ if(custom[k] && String(custom[k]).toLowerCase()===w) return k; } }
    for(var lang in NACL_LEX){ var L=NACL_LEX[lang]; for(var k2 in L){ if(String(L[k2]).toLowerCase()===w) return k2; } }
    return null;
  }

  window.NUMU_SHELL = {
    TONES: TONES, TONE_META: TONE_META, STATUS: STATUS, CHART: CHART, ACCENTS: ACCENTS, SECONDARY_ACCENT: SECONDARY_ACCENT,
    TENANTS: TENANTS, WORKSPACES: WORKSPACES, PAGES: PAGES, ME: ME,
    buildVars: buildVars, applyTheme: applyTheme, themeHexes: themeHexes, toneName: toneName,
    lsGet: lsGet, setPref: setPref, resolve: resolve, modeTabs: modeTabs, workspaces: workspaces,
    NACL_LEX: NACL_LEX, NACL_VERBS: NACL_VERBS, naclSkin: naclSkin, naclCustomParse: naclCustomParse, naclKw: naclKw, naclCanon: naclCanon
  };
})();

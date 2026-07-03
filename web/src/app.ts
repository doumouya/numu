/* app.ts — the numu console shell: tenant rail + top bar + Objects panel +
   conversation feed + Context panel, over the NumuClient seam. CRUD + CSV are
   REAL: everything routes through the sim engine (or, with NUMU_HTTP, an HTTP
   backend serving the same surface). The two-axis look (numu|numu-blue ×
   light|dark) is amenan-ui's theme platform — a switch is one attribute write.

   State lives here; each region is a mount with an update() — a state change
   re-renders exactly the regions it touches (no framework, no vdom). */

import { el, setTheme, setMode, getTheme, getMode, toggleMode, onThemeChange, toast } from "amenan-ui";
import { ncl, ORG_OF, PRJ_OF, prefetchValues } from "./client.ts";
import { mountTenantRail, type TenantRailCfg } from "./console/tenant-rail.ts";
import { mountProjectsPanel } from "./console/projects-panel.ts";
import { mountFeed } from "./console/feed.ts";
import { mountComposer } from "./console/composer.ts";
import { mountContextPanel, type ContextPanelCfg } from "./console/context-panel.ts";
import { mountConnectors } from "./console/connectors.ts";

const CCD = window.CONSOLE_DATA;

type Accent = "numu" | "numu-blue";
type PageId = "workspace" | "connectors";

interface AppState {
  tenantId: string;
  activeProject: string;
  overviewActive: boolean;
  channel: string;
  feed: NumuBlock[];
  itFile: Record<string, string | undefined>;
  page: PageId;
  contextObject: ContextPanelCfg["object"];
  contextExpanded: boolean;
}

const boot = getTheme();
const state: AppState = {
  tenantId: "studio",
  activeProject: "a1",
  overviewActive: false,
  channel: "chat",
  feed: [],
  itFile: {},
  page: "workspace",
  contextObject: CCD.data["studio"]?.objects[0] ?? null,
  contextExpanded: false,
};
let accent: Accent = boot === "numu-blue" ? "numu-blue" : "numu";

const tenantOf = (id: string): ConsoleTenantData => CCD.data[id] ?? (CCD.data["studio"] as ConsoleTenantData);

/* ── layout skeleton ───────────────────────────────────────────────────── */

const rootHost = document.getElementById("root");
if (!rootHost) throw new Error("no #root");
const railHost = el("div", { class: "nu-rail-host" });
const topbar = el("header", { class: "nu-topbar" });
const projectsHost = el("div", { class: "nu-panel-host" });
const centerHost = el("main", { class: "nu-center" });
const contextHost = el("div", { class: "nu-context-host" });
const body = el("div", { class: "nu-body" }, projectsHost, centerHost, contextHost);
rootHost.appendChild(el("div", { class: "nu-app" }, railHost, el("div", { class: "nu-main" }, topbar, body)));

/* center: the feed page (scroll + composer) vs the connectors page */
const feedPage = el("div", { class: "nu-feed" });
const connectorsPage = el("div", { class: "nu-connectors-page", hidden: "hidden" });
centerHost.appendChild(feedPage);
centerHost.appendChild(connectorsPage);

/* ── region mounts ─────────────────────────────────────────────────────── */

function railCfg(): TenantRailCfg {
  return {
    tenants: CCD.tenants,
    me: CCD.me,
    activeTenantId: state.tenantId,
    page: state.page,
    mode: getMode(),
    accent,
    onTenant: switchTenant,
    onToggleAccent() {
      accent = accent === "numu" ? "numu-blue" : "numu";
      setTheme(accent);
      toast({ title: "Theme", message: accent === "numu" ? "ink accent" : "blue accent" });
    },
    onToggleMode: toggleMode,
    onConnectors() {
      state.page = state.page === "connectors" ? "workspace" : "connectors";
      renderCenter();
      rail.update(railCfg());
    },
    onNotifications: () => toast({ title: "Notifications", message: "You're all caught up." }),
    onSettings: () => toast({ title: "Settings", message: "Not built yet.", tone: "warn" }),
    onProfile: () => toast({ title: "Profile", message: CCD.me.role }),
  };
}
const rail = mountTenantRail(railHost, railCfg());

function projectsCfg() {
  const T = tenantOf(state.tenantId);
  return {
    overview: T.overview,
    channels: T.channels,
    projects: T.projects,
    objects: T.objects,
    activeProjectId: state.overviewActive ? null : state.activeProject,
    activeObjectId:
      state.contextObject && "id" in state.contextObject ? state.contextObject.id : null,
    overviewActive: state.overviewActive,
    onSelectProject(id: string) {
      state.activeProject = id;
      state.overviewActive = false;
      projects.update(projectsCfg());
    },
    onSelectOverview() {
      state.overviewActive = true;
      projects.update(projectsCfg());
    },
    onOpenObject(o: ConsoleObject) {
      state.contextObject = o;
      state.contextExpanded = false;
      renderContext();
      projects.update(projectsCfg());
    },
    onNew: () => toast({ title: "New project", message: "Created in Clients.", tone: "ok" }),
  };
}
const projects = mountProjectsPanel(projectsHost, projectsCfg());

function feedCfg() {
  return {
    feed: state.feed,
    onOpenObject(b: NumuObjectBlock) {
      const T = tenantOf(state.tenantId);
      const hit = b.objRef ? T.objects.find((o) => o.id === b.objRef) : null;
      state.contextObject = hit ?? T.objects.find((o) => o.type === "record") ?? T.objects[0] ?? null;
      state.contextExpanded = false;
      renderContext();
      projects.update(projectsCfg());
    },
    onSaveAttachment: saveAttachment,
  };
}
const feed = mountFeed(feedPage, feedCfg());

const composer = mountComposer(feedPage, {
  naclHint: tenantOf(state.tenantId).naclHint,
  suggestions: tenantOf(state.tenantId).suggestions,
  feed: () => state.feed,
  onSend: send,
});

const context = mountContextPanel(contextHost, contextCfg());
function contextCfg(): ContextPanelCfg {
  return {
    object: state.contextObject,
    expanded: state.contextExpanded,
    onExpand() {
      state.contextExpanded = !state.contextExpanded;
      renderContext();
      renderCenter();
    },
    onClose() {
      state.contextObject = null;
      state.contextExpanded = false;
      renderContext();
      renderCenter();
      projects.update(projectsCfg());
    },
  };
}

const connectors = mountConnectors(connectorsPage, {
  groups: CCD.connectors,
  activeId: null,
  onOpen(c: ConsoleConnector) {
    state.contextObject = { ...c, type: "connector" as const };
    state.contextExpanded = false;
    renderContext();
    connectors.update({
      groups: CCD.connectors,
      activeId: c.id,
      onOpen: connectorsOnOpen,
    });
  },
});
const connectorsOnOpen = (c: ConsoleConnector): void => {
  state.contextObject = { ...c, type: "connector" as const };
  state.contextExpanded = false;
  renderContext();
};

/* ── renders ───────────────────────────────────────────────────────────── */

function renderTopbar(): void {
  const tenant = CCD.tenants.find((t) => t.id === state.tenantId) ?? CCD.tenants[1];
  if (!tenant) return;
  topbar.textContent = "";
  topbar.appendChild(
    el(
      "div",
      { class: "nu-tenant-chip" },
      el("span", { class: "nu-tenant-mark", style: `background:${tenant.accent}` }, tenant.mark),
      el(
        "span",
        { class: "nu-tenant-id" },
        el("span", { class: "nu-tenant-name" }, tenant.name),
        el("span", { class: "nu-tenant-sub" }, tenant.sub + (ncl.kind === "http" ? " · node" : " · on device")),
      ),
    ),
  );
}

function renderCenter(): void {
  const showConnectors = state.page === "connectors";
  const hideCenter = state.contextExpanded;
  projectsHost.hidden = hideCenter;
  feedPage.hidden = hideCenter || showConnectors;
  connectorsPage.hidden = hideCenter || !showConnectors;
}

function renderContext(): void {
  context.update(contextCfg());
}

function renderFeed(): void {
  feed.update(feedCfg());
  feed.scrollToEnd();
}

/* ── seam wiring ───────────────────────────────────────────────────────── */

function pushBlocks(bs: NumuBlock[]): void {
  if (!bs.length) return;
  state.feed = state.feed.concat(bs);
  void ncl.appendFeed(ORG_OF[state.tenantId] ?? "", bs);
  renderFeed();
}

function persistFeed(next: NumuBlock[]): void {
  state.feed = next;
  if (ncl.setFeed) void ncl.setFeed(ORG_OF[state.tenantId] ?? "", next);
  renderFeed();
}

function applyEffects(effects: NumuEffect[]): void {
  const T = tenantOf(state.tenantId);
  effects.forEach((ef) => {
    if (ef.kind === "theme") {
      const v = String(ef.value ?? "").toLowerCase();
      if (v === "dark" || v === "light") setMode(v);
      if (v === "blue") {
        accent = "numu-blue";
        setTheme(accent);
      }
      if (v === "ink") {
        accent = "numu";
        setTheme(accent);
      }
    } else if (ef.kind === "closePanel") {
      state.contextObject = null;
      state.contextExpanded = false;
      renderContext();
      renderCenter();
    } else if (ef.kind === "play") {
      const q = String(ef.query ?? "").toLowerCase();
      const audio = T.objects.find((o) => o.type === "audio" && (!q || o.name.toLowerCase().includes(q)));
      if (audio) {
        state.contextObject = audio;
        state.contextExpanded = false;
        renderContext();
      }
    } else if (ef.kind === "it" && ef.id) {
      state.itFile[state.tenantId] = ef.id;
    }
  });
}

/** send — nacl over the seam: parse → plan → REAL execution (registry + csv steps) */
function send(text: string): void {
  const ctx: NumuNaclCtx = {
    workspace: ORG_OF[state.tenantId],
    projectId: PRJ_OF(state.activeProject),
    itFileId: state.itFile[state.tenantId],
    channel: state.channel,
  };
  const run = (retried: boolean): Promise<void> =>
    ncl.nacl(text, ctx).then((r) => {
      const res = r ?? { blocks: [], effects: [] };
      const need = (res.effects ?? []).find((e) => e.kind === "needBlob");
      if (need?.id && !retried) return ncl.ensureBlob(need.id).then(() => run(true));
      applyEffects(res.effects ?? []);
      pushBlocks(res.blocks ?? []);
      return undefined;
    });
  run(false).catch((e: unknown) =>
    toast({ title: "nacl", message: String(e instanceof Error ? e.message : e), tone: "danger" }),
  );
}

/** Save to chat — the one-write-path CSV pipeline over the real attachment bytes */
function saveAttachment(em: NumuEmailBlock): void {
  const att = em.attachment;
  if (!att) return;
  const src = "data/uploads/" + att.name;
  toast({ title: "Ingesting", message: att.name + " · parse + profile…", mono: true });
  fetch(src)
    .then((r) => {
      if (!r.ok) throw new Error("could not fetch " + att.name);
      return r.text();
    })
    .then((text) =>
      ncl.uploadCsv(PRJ_OF(state.activeProject), att.name, text, src).then((res) => {
        if (res.status !== 201) {
          const detail = (res.body as { detail?: string } | null)?.detail;
          toast({ title: "Upload", message: detail ?? "failed", tone: "danger" });
          return;
        }
        const out = res.body;
        const blocks: NumuBlock[] = [
          {
            type: "step",
            nacl: "save " + att.name,
            kind: "save",
            impact:
              out.rid +
              " · " +
              out.encoding +
              " · " +
              (out.wrapped ? "wrapped single-column (unwrap to split) · " : "") +
              "cleanness " +
              out.cleanness +
              "% · blob immutable, steps derive",
          },
          window.NumuNacl.profileBlock(out.filename, "email attachment · on device · GlueSQL", out),
        ];
        persistFeed(
          state.feed
            .map((x) => (x === em ? { ...x, attachment: { ...att, saved: true } } : x))
            .concat(blocks),
        );
        state.itFile[state.tenantId] = out.rid;
        prefetchValues(out.rid, out.columns);
        toast({
          title: "Saved",
          message: out.filename + " · " + out.row_count.toLocaleString() + " rows · cleanness " + out.cleanness + "%",
          tone: "ok",
          mono: true,
        });
      }),
    )
    .catch(() => toast({ title: "Upload", message: "could not fetch " + att.name, tone: "danger" }));
}

/* ── tenant switch + feed bootstrap ────────────────────────────────────── */

function loadFeed(tenantId: string): void {
  const key = ORG_OF[tenantId] ?? "";
  void ncl.feed(key).then((f) => {
    if (tenantId !== state.tenantId) return;
    if (f && f.length) {
      state.feed = f;
      renderFeed();
      return;
    }
    const demo = tenantOf(tenantId).feed;
    void ncl.appendFeed(key, demo);
    state.feed = demo.slice();
    renderFeed();
  });
}

function switchTenant(id: string): void {
  const nt = tenantOf(id);
  state.tenantId = id;
  state.activeProject = nt.projects[0]?.id ?? "";
  state.overviewActive = false;
  state.contextObject = nt.objects[0] ?? null;
  state.contextExpanded = false;
  state.feed = [];
  rail.update(railCfg());
  projects.update(projectsCfg());
  composer.update({ naclHint: nt.naclHint, suggestions: nt.suggestions });
  renderTopbar();
  renderContext();
  renderCenter();
  loadFeed(id);
  const tenant = CCD.tenants.find((t) => t.id === id);
  if (tenant) toast({ title: "Workspace", message: tenant.name });
}

/* ── theme reaction: charts re-read tokens, the rail relabels ──────────── */

onThemeChange(() => {
  accent = getTheme() === "numu-blue" ? "numu-blue" : "numu";
  rail.update(railCfg());
  renderFeed();
  renderContext();
});

/* ── boot ──────────────────────────────────────────────────────────────── */

setTheme(accent);
setMode(getMode());
renderTopbar();
renderCenter();
renderContext();
loadFeed(state.tenantId);

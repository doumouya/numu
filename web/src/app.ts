/* app.ts — the numu console shell: tenant rail (operator chrome) + topbar +
   Objects panel + conversation feed + the docked nacl composer + Context panel
   + the Store, over the NumuClient seam. CRUD + CSV are REAL: everything
   routes through the sim engine (or, with ?http=1, an HTTP backend serving the
   same surface). Appearance = accent (numu|numu-blue) × mode (light|dark) ×
   skin (midnight + gradient trio on the --brand channel), each persisted.
   Impersonation is the operator's view-as: explicit, time-bound, logged.

   State lives here; each region is a mount with an update() — a state change
   re-renders exactly the regions it touches (no framework, no vdom). */

import { el, icon, setTheme, setMode, getTheme, getMode, onThemeChange, toast } from "amenan-ui";
import { ncl, ORG_OF, PRJ_OF, prefetchValues } from "./client.ts";
import { mountTenantRail, type ImpTarget } from "./console/tenant-rail.ts";
import { mountProjectsPanel, initialsOf, type NewProjectOpts } from "./console/projects-panel.ts";
import { mountFeed } from "./console/feed.ts";
import { mountComposer } from "./console/composer.ts";
import { mountContextPanel, type ContextPanelCfg } from "./console/context-panel.ts";
import { mountStore, type StoreOpen } from "./console/store.ts";

const CCD = window.CONSOLE_DATA;

type Accent = "numu" | "numu-blue";
type PageId = "workspace" | "store";
type PanelObject = ContextPanelCfg["object"];

/* ── impersonation targets: users in the registry seed (≠ the operator) ── */
const IMP_LABEL: Record<string, string> = { USR_marc: "engineer · member", USR_nova: "artist · viewer", USR_kessy: "artist · viewer" };
const IMP_TARGETS: ImpTarget[] = (window.NumuSeed?.ENTITIES ?? [])
  .filter((e) => e[1] === "user" && e[0] !== "USR_jm")
  .map((e) => ({ id: e[0], name: String(e[2]["display_name"] ?? e[0]), label: IMP_LABEL[e[0]] ?? "member" }));

function canSeeTenant(actorId: string, orgId: string): boolean {
  const eng = ncl.engine;
  if (!eng) return true; // http driver: the server enforces reach
  if (eng.isPlatformAdmin(actorId)) return true;
  const pr = eng.principals(actorId);
  return eng.state.memberships.some((m) => pr.includes(m.member_id) && eng.scopeChain(m.object_id).includes(orgId));
}

/* ── Objects panel bound to the REGISTRY — reach-filtered for the actor ── */
const CHART_TOKENS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
];
const hashTok = (s: string): string =>
  CHART_TOKENS[String(s).split("").reduce((a, c) => a + c.charCodeAt(0), 0) % CHART_TOKENS.length] ?? "var(--chart-1)";

function buildLive(tenantId: string): { projects: ConsoleProject[]; objects: ConsoleObject[] } {
  const eng = ncl.engine;
  const T0 = CCD.data[tenantId] ?? (CCD.data["studio"] as ConsoleTenantData);
  if (!eng) return { projects: T0.projects, objects: T0.objects };
  const org = ORG_OF[tenantId] ?? "";
  const actor = ncl.actor;
  const inOrg = (id: string): boolean => eng.scopeChain(id).includes(org);
  const attrs = (e: NumuEntity): Record<string, unknown> => e.data.attributes ?? {};

  const projects: ConsoleProject[] = eng
    .reachable(actor, "project")
    .filter((e) => inOrg(e.id) && !attrs(e)["queue"])
    .map((e) => ({
      id: e.id.replace(/^PRJ_/, ""),
      name: String(e.data["name"] ?? e.id),
      mark: initialsOf(String(e.data["name"] ?? "?")),
      icon: String(attrs(e)["icon"] ?? ""),
      color: String(attrs(e)["color"] || hashTok(e.id)),
      channel: String(attrs(e)["channel"] ?? "artists"),
      pinned: !!attrs(e)["pinned"],
    }));

  const files = eng
    .reachable(actor, "file")
    .filter((e) => inOrg(e.id) && ["audio", "video", "image"].includes(String(e.data["file_type"])));
  const fObjs: ConsoleObject[] = files.map((e) => {
    const a = attrs(e);
    const type = String(e.data["file_type"]);
    return {
      id: e.id,
      type,
      name: String(e.data["filename"] ?? e.id),
      artist: String(a["artist"] ?? ""),
      artistId: a["artist_id"] ? String(a["artist_id"]) : undefined,
      album: a["album"] ? String(a["album"]) : undefined,
      year: a["year"] ? String(a["year"]) : undefined,
      no: typeof a["no"] === "number" ? (a["no"] as number) : undefined,
      cover: a["cover"] ? String(a["cover"]) : null,
      src: a["src"] ? String(a["src"]) : undefined,
      meta: String(a["meta"] ?? type),
      icon: String(a["icon"] ?? "file-earmark"),
      accent: String(a["accent"] || hashTok(e.id)),
      duration: String(a["duration"] ?? "–:–"),
      pos: "0:00",
      posPct: 0,
      gallery: type === "image" ? 6 : undefined,
    };
  });

  const byArtist: Record<string, ConsoleObject[]> = {};
  fObjs.forEach((o) => {
    if (o.artistId && o.type === "audio") (byArtist[o.artistId] = byArtist[o.artistId] ?? []).push(o);
  });
  const aObjs: ConsoleObject[] = Object.keys(byArtist)
    .map((uid): ConsoleObject | null => {
      const u = eng.state.entities[uid];
      if (!u) return null;
      const at = u.data.attributes ?? {};
      const tracks = (byArtist[uid] ?? []).sort((x, y) => (x.no ?? 99) - (y.no ?? 99));
      const albums: Array<{ title: string; year?: string; cover?: string | null }> = [];
      tracks.forEach((t) => {
        if (t.album && !albums.some((al) => al.title === t.album)) albums.push({ title: t.album, year: t.year, cover: t.cover });
      });
      return {
        id: "artist_" + uid,
        type: "artist",
        name: String(at["artist_name"] ?? u.data["display_name"] ?? uid),
        meta: `${String(at["genre"] ?? "artist")} · ${tracks.length} tracks · roster`,
        icon: "person-badge",
        accent: hashTok(uid),
        plays: String(at["plays"] ?? "—"),
        tracks,
        albums,
        cover: albums.length ? albums[0]?.cover ?? null : null,
      };
    })
    .filter((x): x is ConsoleObject => x !== null);

  const bObjs: ConsoleObject[] = eng
    .reachable(actor, "booking")
    .filter((e) => inOrg(e.id) && e.data["kind"] !== "hold")
    .map((e) => ({
      id: e.id,
      type: "record",
      name: String(e.data["name"] ?? e.id),
      code: String(attrs(e)["code"] ?? e.id),
      status: String(e.data["status"] ?? ""),
      icon: "record-circle",
      accent: hashTok(e.id),
      fields: [
        ["kind", String(e.data["kind"] ?? "")],
        ["starts", String(e.data["starts_at"] ?? "").replace("T", " ")],
        ["ends", String(e.data["ends_at"] ?? "").replace("T", " ")],
        ["venue", e.data["address_id"] === "ADR_sa" ? "Studio A" : e.data["address_id"] === "ADR_sb" ? "Studio B" : "—"],
      ] as Array<[string, string]>,
    }));

  return { projects, objects: [...aObjs, ...fObjs, ...bObjs] };
}

/* ── state ─────────────────────────────────────────────────────────────── */

const state = {
  tenantId: "studio",
  activeProject: null as string | null,
  overviewActive: true,
  channel: "chat",
  feed: [] as NumuBlock[],
  itFile: {} as Record<string, string | undefined>,
  page: "workspace" as PageId,
  contextObject: null as PanelObject,
  contextExpanded: false,
  projectsOpen: true,
  viewAs: null as (ImpTarget & { until: string }) | null,
};
let accent: Accent = getTheme() === "numu-blue" ? "numu-blue" : "numu";
let skin = ((): string => {
  try { return localStorage.getItem("numu_skin") ?? ""; } catch { return ""; }
})();

const tenantOf = (id: string): ConsoleTenantData => CCD.data[id] ?? (CCD.data["studio"] as ConsoleTenantData);
const notify = (title: string, message: string, tone?: string): void => {
  toast({ title, message, tone: tone as "ok" | "warn" | "danger" | "info" | undefined, mono: true });
};

/* channels are local "this-device" user data, per tenant (numu_chan_v2) */
type ChanStore = Record<string, ConsoleChannel[]>;
let chanStore: ChanStore = ((): ChanStore => {
  try { return JSON.parse(localStorage.getItem("numu_chan_v2") ?? "{}") as ChanStore; } catch { return {}; }
})();
const seedChannels = (tid: string): ConsoleChannel[] =>
  tenantOf(tid).channels.filter((c) => c.id !== "pinned").map((c) => ({ id: c.id, name: c.name, icon: c.icon, system: true }));
const railChannels = (): ConsoleChannel[] => chanStore[state.tenantId] ?? seedChannels(state.tenantId);
function mutateChannels(fn: (cur: ConsoleChannel[]) => ConsoleChannel[]): void {
  chanStore = { ...chanStore, [state.tenantId]: fn(railChannels().slice()) };
  try { localStorage.setItem("numu_chan_v2", JSON.stringify(chanStore)); } catch { /* quota */ }
  renderPanel();
}

/* ── skins (appearance = accent × mode × skin) ─────────────────────────── */

function applySkinAttr(): void {
  appRoot.setAttribute("data-skin", skin);
}
function setSkin(s: string): void {
  skin = s;
  try { localStorage.setItem("numu_skin", s); } catch { /* quota */ }
  applySkinAttr();
}
function applySkin(sk: ConsoleSkin): void {
  accent = sk.theme;
  setTheme(sk.theme);
  setMode(sk.mode);
  setSkin(sk.skin || "");
}
const activeSkinId = (): string =>
  CCD.settings.skins.find((s) => s.theme === accent && s.mode === getMode() && (s.skin || "") === (skin || ""))?.id ?? "";

/* ── layout skeleton ───────────────────────────────────────────────────── */

const rootHost = document.getElementById("root");
if (!rootHost) throw new Error("no #root");
const railHost = el("div", { class: "nu-rail-host" });
const banner = el("div", { class: "nu-imp-banner", hidden: "hidden" });
const topbar = el("header", { class: "nu-topbar" });
const projectsHost = el("div", { class: "nu-panel-host" });
const centerHost = el("main", { class: "nu-center" });
const contextHost = el("div", { class: "nu-context-host" });
const body = el("div", { class: "nu-body" }, projectsHost, centerHost, contextHost);
const appRoot = el("div", { class: "nu-app" }, railHost, el("div", { class: "nu-main" }, banner, topbar, body));
rootHost.appendChild(appRoot);
applySkinAttr();

const feedPage = el("div", { class: "nu-feed-page" });
const storePage = el("div", { class: "nu-store-page", hidden: "hidden" });
const composerHost = el("div", { class: "nu-composer-host" });
centerHost.appendChild(el("div", { class: "nu-center-col" }, feedPage, storePage, composerHost));

/* ── impersonation ─────────────────────────────────────────────────────── */

function startImpersonation(p: ImpTarget): void {
  const until = new Date(Date.now() + 30 * 60000);
  ncl.actor = p.id;
  ncl.engine?.event(p.id, "USR_jm", "operator.impersonation_started", { purpose: "support · debugging", expires_at: until.toISOString() });
  state.viewAs = { ...p, until: until.toTimeString().slice(0, 5) };
  const reach = CCD.tenants.filter((t) => canSeeTenant(p.id, ORG_OF[t.id] ?? ""));
  if (!reach.some((t) => t.id === state.tenantId) && reach.length) switchTenant(reach[0]!.id);
  notify("Impersonation", `viewing as ${p.name} · grant logged`, "warn");
  renderChrome();
  renderPanel();
}
function exitImpersonation(): void {
  if (state.viewAs) ncl.engine?.event(state.viewAs.id, "USR_jm", "operator.impersonation_ended", {});
  ncl.actor = "USR_jm";
  state.viewAs = null;
  notify("Impersonation", "back to operator view");
  renderChrome();
  renderPanel();
}
const impersonateUser = (u: ConsoleUserRecordData): void =>
  startImpersonation({ id: u.id, name: u.name, label: u.role });
const canImpersonate = (): boolean => !!ncl.engine && !state.viewAs;
const meId = (): string => state.viewAs?.id ?? "USR_jm";
const meRecord = (): ConsoleUserRecordData => CCD.users[meId()] ?? (CCD.users["USR_jm"] as ConsoleUserRecordData);

/* ── resolve any object reference to a Record the panel can open ───────── */

function recordFromRef(ref: string | undefined): PanelObject {
  if (!ref) return null;
  const known = CCD.users[ref];
  if (known) return known;
  const eng = ncl.engine;
  const e = eng?.state.entities[ref];
  if (!e || !eng) return null;
  const d = e.data;
  const nameOf = (id: unknown): string => {
    const x = typeof id === "string" ? eng.state.entities[id] : undefined;
    return x ? String(x.data["display_name"] ?? x.data["name"] ?? x.data["title"] ?? id) : String(id);
  };
  const skip = new Set(["attributes", "blob_ref", "columns_meta", "steps", "spec", "slug", "workflow_id", "project_id", "assignee_id", "reporter_id", "title", "name", "display_name", "filename", "description", "status", "type", "priority", "origin"]);
  const fields: Array<[string, string]> = Object.keys(d)
    .filter((k) => !skip.has(k) && d[k] != null && typeof d[k] !== "object")
    .map((k) => [k, /_id$/.test(k) ? nameOf(d[k]) : String(d[k])]);
  const at = d.attributes ?? {};
  Object.keys(at).forEach((k) => {
    if (at[k] != null && typeof at[k] !== "object") fields.push([k, String(at[k])]);
  });
  const name = String(d["name"] ?? d["title"] ?? d["display_name"] ?? d["filename"] ?? e.id);
  const base: ConsoleObject = { id: e.id, code: e.id, name, status: String(d["status"] ?? "active"), fields, version: e.version, type: "record", icon: "collection", accent: "var(--chart-2)" };
  if (e.type === "case") {
    const EXT = new Set(["web", "email", "phone", "chat"]);
    const wf = window.NumuSeed?.WORKFLOWS[String(d["workflow_id"] ?? "default")] ?? null;
    return {
      ...base,
      type: "case",
      caseType: String(d["type"] ?? "task"),
      priority: String(d["priority"] ?? "normal"),
      origin: String(d["origin"] ?? "ui"),
      classification: EXT.has(String(d["origin"])) ? "external" : "internal",
      assignee: d["assignee_id"] ? nameOf(d["assignee_id"]) : null,
      reporter: d["reporter_id"] ? nameOf(d["reporter_id"]) : null,
      project: nameOf(d["project_id"]),
      workflowId: String(d["workflow_id"] ?? "default"),
      wfStates: wf ? wf.states : null,
      description: String(d["description"] ?? ""),
    };
  }
  return base;
}

/* ── projects: ENGINE objects (create/rename/move/pin/delete over the seam) ── */

const projRid = (sid: string): string => (sid.startsWith("PRJ_") ? sid : "PRJ_" + sid);
const projEntity = (sid: string): NumuEntity | undefined => ncl.engine?.state.entities[projRid(sid)];
function patchProject(sid: string, patch: Record<string, unknown>): void {
  const e = projEntity(sid);
  if (!e) return;
  void ncl
    .request("PATCH", "/api/objects/project/" + projRid(sid), { body: patch, headers: { "If-Match": `W/"${e.version}"` } })
    .then(renderPanel)
    .catch(() => {});
}
const renameProject = (sid: string, name: string): void => patchProject(sid, { name });
const moveProject = (sid: string, channel: string): void => {
  const e = projEntity(sid);
  if (e) patchProject(sid, { attributes: { ...(e.data.attributes ?? {}), channel } });
};
const togglePin = (sid: string): void => {
  const e = projEntity(sid);
  if (!e) return;
  const a = e.data.attributes ?? {};
  patchProject(sid, { attributes: { ...a, pinned: !a["pinned"] } });
};
function deleteProject(sid: string): void {
  const e = projEntity(sid);
  if (!e) return;
  void ncl
    .request("DELETE", "/api/objects/project/" + projRid(sid), { headers: { "If-Match": `W/"${e.version}"` } })
    .then(() => {
      if (state.activeProject === sid) {
        state.activeProject = null;
        state.overviewActive = true;
      }
      renderPanel();
    })
    .catch(() => {});
}
function newProject(o: NewProjectOpts): void {
  const org = ORG_OF[state.tenantId];
  if (!org) {
    notify("Project", "No workspace for this tenant", "warn");
    return;
  }
  const chan = o.channel ?? railChannels()[0]?.id ?? "artists";
  const nm = o.name || "New conversation";
  void ncl
    .request("POST", "/api/objects/project", {
      body: { workspace_id: org, name: nm, origin: "manual", status: "active", attributes: { channel: chan, pinned: false, icon: o.icon, color: o.color } },
    })
    .then((res) => {
      const bodyOut = res.body as { id?: string } | null;
      if (res.status === 201 && bodyOut?.id) {
        state.activeProject = bodyOut.id.replace(/^PRJ_/, "");
        state.overviewActive = false;
        renderPanel();
        notify("Project", o.name ? `Created ${nm}` : "New conversation — rename it via ⋯", "ok");
      } else notify("Project", "Could not create", "warn");
    })
    .catch(() => notify("Project", "Could not create", "warn"));
}

/* ── panel navigation: settings + profile live in the Context panel ────── */

function openSettings(): void {
  state.contextObject = { type: "settings", name: "Settings", accent: "var(--accent)" };
  state.contextExpanded = true;
  renderContext();
  renderCenter();
  renderChrome();
}
function openProfile(): void {
  state.contextObject = { ...meRecord(), self: !state.viewAs };
  state.contextExpanded = false;
  renderContext();
  renderCenter();
  renderChrome();
}
function openUser(u: ConsoleUserRecordData): void {
  state.contextObject = { ...u };
  state.contextExpanded = false;
  renderContext();
  renderCenter();
}
function openPanelObject(o: PanelObject): void {
  state.contextObject = o;
  if (!(o && "type" in o && o.type === "video")) state.contextExpanded = false;
  renderContext();
  renderCenter();
  renderPanel();
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
  effects.forEach((ef) => {
    if (ef.kind === "theme") {
      const v = String(ef.value ?? "").toLowerCase();
      if (v === "dark" || v === "light") setMode(v);
      if (v === "blue") { accent = "numu-blue"; setTheme(accent); }
      if (v === "ink") { accent = "numu"; setTheme(accent); }
    } else if (ef.kind === "closePanel") {
      state.contextObject = null;
      state.contextExpanded = false;
      renderContext();
      renderCenter();
    } else if (ef.kind === "play") {
      const q = String(ef.query ?? "").toLowerCase();
      const audio = buildLive(state.tenantId).objects.find((o) => o.type === "audio" && (!q || o.name.toLowerCase().includes(q)));
      if (audio) openPanelObject({ ...audio, autoplay: true });
    } else if (ef.kind === "it" && ef.id) {
      state.itFile[state.tenantId] = ef.id;
    }
  });
}

/** send — nacl over the seam: parse → plan → REAL execution */
function send(text: string): void {
  /* read:users — everyone the actor can reach, as a table block */
  if (/^(read:users\b|list\s+users\b|users$)/i.test(text)) {
    const us = ncl.engine ? ncl.engine.reachable(ncl.actor, "user") : [];
    const rows: NumuObjectTableRow[] = us.map((e) => ({
      id: e.id,
      title: String(e.data["display_name"] ?? e.data["name"] ?? e.id),
      status: String(e.data["status"] ?? ""),
      meta: `@${String(e.data["handle"] ?? "?")} · v${e.version}`,
      objRef: e.id,
    }));
    pushBlocks([{ type: "objectTable", objType: "user", icon: "person", title: `user · ${rows.length} rows`, rows }]);
    if (state.page !== "workspace") {
      state.page = "workspace";
      renderCenter();
      renderChrome();
    }
    return;
  }
  const ctx: NumuNaclCtx = {
    workspace: ORG_OF[state.tenantId],
    projectId: state.activeProject ? PRJ_OF(state.activeProject) : undefined,
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
  run(false).catch((e: unknown) => notify("nacl", String(e instanceof Error ? e.message : e), "danger"));
}

/** Save to chat — the one-write-path CSV pipeline over the real bytes */
function saveAttachment(em: NumuEmailBlock): void {
  const att = em.attachment;
  if (!att) return;
  const src = "data/uploads/" + att.name;
  notify("Ingesting", `${att.name} · parse + profile…`);
  fetch(src)
    .then((r) => {
      if (!r.ok) throw new Error("fetch");
      return r.text();
    })
    .then((text) =>
      ncl.uploadCsv(state.activeProject ? PRJ_OF(state.activeProject) : "PRJ_inbox", att.name, text, src).then((res) => {
        if (res.status !== 201) {
          notify("Upload", (res.body as { detail?: string } | null)?.detail ?? "failed", "danger");
          return;
        }
        const out = res.body;
        const blocks: NumuBlock[] = [
          {
            type: "step",
            nacl: "save " + att.name,
            kind: "save",
            impact: `${out.rid} · ${out.encoding} · ${out.wrapped ? "wrapped single-column (unwrap to split) · " : ""}cleanness ${out.cleanness}% · blob immutable, steps derive`,
          },
          window.NumuNacl.profileBlock(out.filename, "email attachment · on device · GlueSQL", out),
        ];
        persistFeed(state.feed.map((x) => (x === em ? { ...x, attachment: { ...att, saved: true } } : x)).concat(blocks));
        state.itFile[state.tenantId] = out.rid;
        prefetchValues(out.rid, out.columns);
        notify("Saved", `${out.filename} · ${out.row_count.toLocaleString()} rows · cleanness ${out.cleanness}%`, "ok");
      }),
    )
    .catch(() => notify("Upload", "could not fetch " + att.name, "danger"));
}

/* ── region mounts ─────────────────────────────────────────────────────── */

const rail = mountTenantRail(railHost, railCfg());
function railCfg() {
  return {
    tenants: CCD.tenants,
    activeTenantId: state.tenantId,
    impTargets: IMP_TARGETS,
    onTenant: (id: string) => {
      switchTenant(id);
      const t = CCD.tenants.find((x) => x.id === id);
      if (t) notify("Workspace", t.name);
    },
    onImpersonate: startImpersonation,
  };
}

function panelCfg() {
  const live = buildLive(state.tenantId);
  return {
    channels: railChannels(),
    projects: live.projects,
    objects: live.objects,
    objectsLabel: "Objects",
    activeProjectId: state.overviewActive ? null : state.activeProject,
    activeObjectId: state.contextObject && "id" in state.contextObject ? (state.contextObject as { id: string }).id : null,
    onSelectProject(id: string) {
      state.activeProject = id;
      state.overviewActive = false;
      renderPanel();
    },
    onOpenObject: (o: ConsoleObject) => openPanelObject(o),
    onNewProject: newProject,
    onRenameProject: renameProject,
    onMoveProject: moveProject,
    onDeleteProject: deleteProject,
    onTogglePin: togglePin,
    onAddChannel: (name: string, glyph: string) =>
      mutateChannels((cur) => cur.concat([{ id: "ch_" + Date.now().toString(36), name, icon: glyph || "hash", system: false }])),
    onRenameChannel: (id: string, name: string) => mutateChannels((cur) => cur.map((c) => (c.id === id ? { ...c, name } : c))),
    onDeleteChannel: (id: string) => mutateChannels((cur) => cur.filter((c) => c.id !== id)),
    onReorderChannel: (fromId: string, toId: string) =>
      mutateChannels((cur) => {
        if (fromId === toId) return cur;
        const from = cur.findIndex((c) => c.id === fromId);
        if (from < 0) return cur;
        const arr = cur.slice();
        const moved = arr.splice(from, 1)[0]!;
        const to = arr.findIndex((c) => c.id === toId);
        arr.splice(to < 0 ? arr.length : to, 0, moved);
        return arr;
      }),
    onToggleCollapse: (id: string) => mutateChannels((cur) => cur.map((c) => (c.id === id ? { ...c, collapsed: !c.collapsed } : c))),
    onHideChannel: (id: string) => mutateChannels((cur) => cur.map((c) => (c.id === id ? { ...c, hidden: true, collapsed: false } : c))),
    onRestoreChannel: (id: string) => mutateChannels((cur) => cur.map((c) => (c.id === id ? { ...c, hidden: false } : c))),
  };
}
const projects = mountProjectsPanel(projectsHost, panelCfg());

function feedCfg() {
  return {
    feed: state.feed,
    onOpenObject(b: NumuObjectBlock) {
      const ref = b.objRef;
      const media = ref ? buildLive(state.tenantId).objects.find((o) => o.id === ref) : null;
      openPanelObject(media ?? recordFromRef(ref) ?? null);
    },
    onOpenTableRow(r: NumuObjectTableRow) {
      const media = r.objRef ? buildLive(state.tenantId).objects.find((o) => o.id === r.objRef) : null;
      openPanelObject(media ?? recordFromRef(r.objRef) ?? null);
    },
    onSaveAttachment: saveAttachment,
  };
}
const feed = mountFeed(feedPage, feedCfg());

const composer = mountComposer(composerHost, {
  naclHint: tenantOf(state.tenantId).naclHint,
  suggestions: tenantOf(state.tenantId).suggestions,
  page: state.page,
  feed: () => state.feed,
  onSend: send,
  onChannel: (id) => {
    state.channel = id;
    notify("Channel", id);
  },
  onAction: (title, detail, tone) => notify(title, detail, tone),
});

function settingsCfg() {
  return {
    meId: meId(),
    skinId: activeSkinId(),
    mode: getMode(),
    canImpersonate: canImpersonate(),
    onSkin: (sk: ConsoleSkin) => {
      applySkin(sk);
      renderContext();
    },
    onToggleMode: () => setMode(getMode() === "dark" ? "light" : "dark"),
    onOpenProfile: openProfile,
    onOpenUser: openUser,
    onImpersonate: impersonateUser,
    onToast: notify,
  };
}
function contextCfg(): ContextPanelCfg {
  return {
    object: state.contextObject,
    expanded: state.contextExpanded,
    related: buildLive(state.tenantId).objects.filter((o) => o.type === "video" && o.src),
    canImpersonate: canImpersonate(),
    settings: settingsCfg(),
    onOpenObject: openPanelObject,
    onImpersonate: impersonateUser,
    onToast: notify,
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
      renderChrome();
      renderPanel();
    },
  };
}
const context = mountContextPanel(contextHost, contextCfg());

const store = mountStore(storePage, {
  groups: CCD.connectors,
  apps: CCD.apps,
  agents: CCD.agents,
  activeId: null,
  onOpen: (o: StoreOpen) => {
    openPanelObject(o);
    store.update({ activeId: o.id });
  },
  onToast: notify,
});

/* ── renders ───────────────────────────────────────────────────────────── */

function chromeBtn(glyph: string, title: string, on: () => void, active = false, child?: Node): HTMLElement {
  return el(
    "button",
    { class: `nu-rail-chrome${active ? " is-active" : ""}`, title, "aria-label": title, onclick: on },
    child ?? icon(glyph),
  );
}

function renderChrome(): void {
  /* the viewAs banner */
  banner.textContent = "";
  banner.hidden = !state.viewAs;
  railHost.hidden = !!state.viewAs;
  if (state.viewAs) {
    banner.appendChild(icon("eye", { color: "var(--warn)" }));
    banner.appendChild(el("span", { class: "nu-imp-banner-name" }, `Viewing as ${state.viewAs.name}`));
    banner.appendChild(
      el("span", { class: "nu-imp-banner-meta" }, `${state.viewAs.label} · purpose: support · until ${state.viewAs.until} · granted by JM`),
    );
    banner.appendChild(el("span", { class: "nu-spring" }));
    banner.appendChild(el("span", { class: "nu-imp-banner-live" }, "rbac live · access logged"));
    banner.appendChild(el("button", { class: "nu-imp-exit", onclick: exitImpersonation }, "Exit"));
  }

  /* the topbar */
  const tenant = CCD.tenants.find((t) => t.id === state.tenantId) ?? CCD.tenants[1];
  if (!tenant) return;
  topbar.textContent = "";
  if (state.page === "workspace" || state.page === "store") {
    topbar.appendChild(
      chromeBtn("layout-sidebar", state.projectsOpen ? "Hide panel" : "Show panel", () => {
        state.projectsOpen = !state.projectsOpen;
        renderCenter();
        renderChrome();
      }, state.projectsOpen),
    );
  }
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
  topbar.appendChild(el("span", { class: "nu-spring" }));
  const chrome = el("div", { class: "nu-topbar-chrome" });
  chrome.appendChild(chromeBtn("bell", "Notifications", () => notify("Notifications", "You're all caught up.")));
  chrome.appendChild(
    chromeBtn(
      "",
      accent === "numu" ? "Accent: ink → blue" : "Accent: blue → ink",
      () => {
        accent = accent === "numu" ? "numu-blue" : "numu";
        setTheme(accent);
        notify("Theme", accent === "numu" ? "ink accent" : "blue accent");
      },
      false,
      el("span", { class: "nu-rail-accent-dot nu-brand-dot" }),
    ),
  );
  chrome.appendChild(
    chromeBtn(getMode() === "dark" ? "brightness-high" : "moon-stars", getMode() === "dark" ? "Light mode" : "Dark mode", () =>
      setMode(getMode() === "dark" ? "light" : "dark"),
    ),
  );
  chrome.appendChild(el("span", { class: "nu-topbar-div" }));
  chrome.appendChild(
    chromeBtn("bag", "Store", () => {
      state.page = state.page === "store" ? "workspace" : "store";
      composer.update({ page: state.page });
      renderCenter();
      renderChrome();
    }, state.page === "store"),
  );
  const isSettings = !!state.contextObject && "type" in state.contextObject && state.contextObject.type === "settings";
  chrome.appendChild(chromeBtn("gear", "Settings", openSettings, isSettings));
  const isProfile = !!state.contextObject && "type" in state.contextObject && state.contextObject.type === "user" && !!(state.contextObject as { self?: boolean }).self;
  chrome.appendChild(
    el(
      "button",
      { class: `nu-topbar-me${isProfile ? " is-active" : ""}`, title: "Your profile", "aria-label": "Profile", onclick: openProfile },
      el("span", { class: "nu-rail-me-initials" }, meRecord().name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2)),
    ),
  );
  topbar.appendChild(chrome);
  rail.update(railCfg());
}

function renderCenter(): void {
  const hideCenter = state.contextExpanded;
  projectsHost.hidden = hideCenter || !state.projectsOpen;
  centerHost.hidden = hideCenter;
  feedPage.hidden = state.page !== "workspace";
  storePage.hidden = state.page !== "store";
}

function renderContext(): void {
  context.update(contextCfg());
}
function renderPanel(): void {
  projects.update(panelCfg());
}
function renderFeed(): void {
  feed.update(feedCfg());
  feed.scrollToEnd();
}

/* ── tenant switch + feed bootstrap (EMPTY by default — clean slate) ───── */

function loadFeed(tenantId: string): void {
  const key = ORG_OF[tenantId] ?? "";
  void ncl.feed(key).then((f) => {
    if (tenantId !== state.tenantId) return;
    state.feed = f && f.length ? f : [];
    renderFeed();
  });
}

function switchTenant(id: string): void {
  const nt = tenantOf(id);
  state.tenantId = id;
  state.activeProject = null;
  state.overviewActive = true;
  state.contextExpanded = false;
  state.feed = [];
  /* open on the artist record when the tenant has one (the real EP) */
  state.contextObject = buildLive(id).objects.find((o) => o.type === "artist") ?? null;
  composer.update({ naclHint: nt.naclHint, suggestions: nt.suggestions });
  renderChrome();
  renderPanel();
  renderContext();
  renderCenter();
  loadFeed(id);
}

/* ── theme reaction: charts re-read tokens, the chrome relabels ────────── */

onThemeChange(() => {
  accent = getTheme() === "numu-blue" ? "numu-blue" : "numu";
  renderChrome();
  renderFeed();
  renderContext();
});

/* ── boot ──────────────────────────────────────────────────────────────── */

setTheme(accent);
setMode(getMode());
renderChrome();
renderCenter();
state.contextObject = buildLive(state.tenantId).objects.find((o) => o.type === "artist") ?? null;
renderContext();
loadFeed(state.tenantId);

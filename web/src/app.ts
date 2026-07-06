/* app.ts — the numu console shell: tenant rail (operator chrome) + topbar +
   Objects panel + conversation feed + the docked nacl composer + Context panel
   + the Store, over the NumuClient seam. CRUD + CSV are REAL: everything
   routes through the sim engine (or, with ?http=1, an HTTP backend serving the
   same surface). Appearance = accent (numu|numu-blue) × mode (light|dark) ×
   skin (midnight + gradient trio on the --brand channel), each persisted.
   Impersonation is the operator's view-as: explicit + grant-logged (start/end);
   enforced expiry + per-read audit are phase-B server properties (IMPERSONATION.md).

   State lives here; each region is a mount with an update() — a state change
   re-renders exactly the regions it touches (no framework, no vdom). */

import { el, icon, setTheme, setMode, getTheme, getMode, onThemeChange, toast } from "amenan-ui";
import { ncl, ORG_OF, PRJ_OF, prefetchValues } from "./client.ts";
import { mountRail, type ImpTarget } from "./shell/rail.ts";
import { mountObjectRail, initialsOf, type NewProjectOpts } from "./console/object-rail.ts";
import { mountFeed } from "./console/feed.ts";
import { mountComposer } from "./console/composer.ts";
import { mountContextPanel, type ContextPanelCfg } from "./console/context-panel.ts";
import { mountStore, type StoreOpen } from "./console/store.ts";
import { registerApp, appList, currentApp, onAppChange, type AppId } from "./shell/apps.ts";
import { initRouter, navigate } from "./shell/router.ts";
import { buildLayout } from "./shell/layout.ts";
import { auth, identityRecord, doLogout } from "./shell/auth.ts";

const CCD = window.CONSOLE_DATA;

type Accent = "numu" | "numu-blue";
type PageId = AppId;
type PanelObject = ContextPanelCfg["object"];

/* ── impersonation targets: THE SELECTED WORKSPACE'S users (≠ the operator).
      Clicking a client workspace on the Impersonation Rail re-scopes this list
      to that client's members — the operator connects as one of THEM. ────── */
const IMP_LABEL: Record<string, string> = { USR_marc: "engineer · member", USR_nova: "artist · viewer", USR_kessy: "artist · viewer" };
function impTargetsFor(tenantId: string): ImpTarget[] {
  const eng = ncl.engine;
  const org = ORG_OF[tenantId] ?? "";
  if (!eng || !org) return [];
  /* members whose membership object sits in this workspace's scope chain */
  const roleOf = new Map<string, string>();
  eng.state.memberships.forEach((m) => {
    if (eng.scopeChain(m.object_id).includes(org)) {
      const label = m.context_role ? `${m.context_role} · ${m.role}` : m.role;
      if (!roleOf.has(m.member_id)) roleOf.set(m.member_id, label);
    }
  });
  return [...roleOf.keys()]
    .map((id) => eng.state.entities[id])
    .filter((e): e is NumuEntity => !!e && e.type === "user" && e.id !== "USR_jm" && e.id !== ncl.actor)
    .map((e) => ({
      id: e.id,
      name: String(e.data["display_name"] ?? e.id),
      label: IMP_LABEL[e.id] ?? roleOf.get(e.id) ?? "member",
    }));
}

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
  objectRailOpen: true,
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
  renderObjectRail();
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
const layout = buildLayout(rootHost);
const { banner, topbar, objectRailHost, centerHost, composerHost, contextHost } = layout;
const impRailHost = layout.railHost;
const appRoot = layout.appRoot;
applySkinAttr();

const feedPage = layout.addSurface("nu-feed-page");
const storePage = layout.addSurface("nu-store-page");

/* the two founding apps of the registry — the workspace (chat + objects) and
   the Store; the Apps Rail and further apps (portfolio manager) land in the
   next shell slices. showApp() owns surface visibility; state.page mirrors
   the current app for the render fns that key off it. */
registerApp({
  id: "workspace",
  label: "Workspace",
  icon: "chat-square-text",
  desc: "the conversation — objects, nacl, feeds",
  order: 10,
  available: () => true,
  surface: feedPage,
  objectRail: true,
});
registerApp({
  id: "store",
  label: "Store",
  icon: "bag",
  desc: "apps · agents · connectors",
  order: 90,
  available: () => true,
  surface: storePage,
  objectRail: true,
});
onAppChange((id) => {
  state.page = id;
  composer.update({ page: id });
  renderCenter();
  renderChrome();
});

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
  renderObjectRail();
}
function exitImpersonation(): void {
  if (state.viewAs) ncl.engine?.event(state.viewAs.id, "USR_jm", "operator.impersonation_ended", {});
  ncl.actor = "USR_jm";
  state.viewAs = null;
  notify("Impersonation", "back to operator view");
  renderChrome();
  renderObjectRail();
}
const impersonateUser = (u: ConsoleUserRecordData): void =>
  startImpersonation({ id: u.id, name: u.name, label: u.role });
const canImpersonate = (): boolean =>
  !!ncl.engine && !state.viewAs && ncl.engine.isPlatformAdmin(ncl.actor);
/* HTTP mode: the live identity (shell/auth.ts) IS `me`; sim keeps Jean
   Mensah as its canon (auth.identity is null there — CCD wins untouched). */
const meId = (): string => state.viewAs?.id ?? auth.identity?.actor_id ?? "USR_jm";
const meRecord = (): ConsoleUserRecordData =>
  CCD.users[meId()] ?? identityRecord() ?? (CCD.users["USR_jm"] as ConsoleUserRecordData);

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
    .then(renderObjectRail)
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
      renderObjectRail();
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
        renderObjectRail();
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
  renderObjectRail();
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
    } else if (ef.kind === "openObjectId" && ef.id) {
      const media = buildLive(state.tenantId).objects.find((o) => o.id === ef.id);
      openPanelObject(media ?? recordFromRef(ef.id) ?? null);
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
    if (state.page !== "workspace") navigate("workspace");
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

const impRail = mountRail(impRailHost, impRailCfg());
function impRailCfg() {
  return {
    /* sim: the canon tenants; http: none yet (real workspaces land with the
       orgs slice) — the rail then opens with the app list. */
    tenants: ncl.kind === "http" ? [] : CCD.tenants,
    activeTenantId: state.tenantId,
    impTargets: impTargetsFor(state.tenantId),
    canImpersonate: !!ncl.engine && !state.viewAs,
    onTenant: (id: string) => {
      switchTenant(id);
      const t = CCD.tenants.find((x) => x.id === id);
      if (t) notify("Workspace", t.name);
    },
    onImpersonate: startImpersonation,
  };
}

function objectRailCfg() {
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
      renderObjectRail();
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
const objectRail = mountObjectRail(objectRailHost, objectRailCfg());

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
    me: identityRecord() ?? undefined,
    skinId: activeSkinId(),
    mode: getMode(),
    canImpersonate: canImpersonate(),
    onLogout:
      ncl.kind === "http"
        ? (): void => {
            if (state.viewAs) exitImpersonation();
            void doLogout(ncl).then((ok) => {
              if (ok) location.replace(location.pathname);
              else notify("Sign out", "could not end the session — try again", "danger");
            });
          }
        : undefined,
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
      renderObjectRail();
    },
  };
}
const context = mountContextPanel(contextHost, contextCfg());

/* the Store's truth depends on the plane: sim shows Jean's full demo catalog;
   HTTP shows the REAL registry as installed and the catalog as an honest
   roadmap ("coming soon", no install actions, no fake connections) — the
   apps doctrine (docs/apps/README.md): one app per purpose, brands become
   sources inside it, never their own surface. */
function storeInventory(): { groups: StoreCfgGroups; apps: ConsoleStoreApp[]; agents: ConsoleStoreApp[] } {
  if (ncl.kind !== "http") return { groups: CCD.connectors, apps: CCD.apps, agents: CCD.agents };
  const real: ConsoleStoreApp[] = appList()
    .filter((a) => a.id !== "store")
    .map((a) => ({
      id: a.id,
      name: a.label,
      cat: "numu",
      icon: a.icon,
      accent: "var(--accent)",
      installed: true,
      tagline: a.desc,
      about: ["A live numu app — it runs on this node, reached from the Apps Rail."],
    }));
  const soonApp = (x: ConsoleStoreApp): ConsoleStoreApp => ({ ...x, installed: false, enabled: false, soon: true });
  return {
    groups: CCD.connectors.map((g) => ({ ...g, items: g.items.map((c) => ({ ...c, connected: false, soon: true })) })),
    apps: real.concat(CCD.apps.map(soonApp)),
    agents: CCD.agents.map(soonApp),
  };
}
type StoreCfgGroups = Array<{ group: string; items: ConsoleConnector[] }>;
const store = mountStore(storePage, {
  ...storeInventory(),
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
    { class: `nu-chrome-btn${active ? " is-active" : ""}`, title, "aria-label": title, onclick: on },
    child ?? icon(glyph),
  );
}

function renderChrome(): void {
  /* the viewAs banner */
  banner.textContent = "";
  banner.hidden = !state.viewAs;
  impRailHost.hidden = !!state.viewAs;
  if (state.viewAs) {
    banner.appendChild(icon("eye", { color: "var(--warn)" }));
    banner.appendChild(el("span", { class: "nu-imp-banner-name" }, `Viewing as ${state.viewAs.name}`));
    banner.appendChild(
      el("span", { class: "nu-imp-banner-meta" }, `${state.viewAs.label} · purpose: support · until ${state.viewAs.until} · granted by JM`),
    );
    banner.appendChild(el("span", { class: "nu-spring" }));
    banner.appendChild(el("span", { class: "nu-imp-banner-live" }, "rbac live · grant logged"));
    banner.appendChild(el("button", { class: "nu-imp-exit", onclick: exitImpersonation }, "Exit"));
  }

  /* the topbar */
  const tenant = CCD.tenants.find((t) => t.id === state.tenantId) ?? CCD.tenants[1];
  if (!tenant) return;
  topbar.textContent = "";
  if (state.page === "workspace" || state.page === "store") {
    topbar.appendChild(
      chromeBtn("layout-sidebar", state.objectRailOpen ? "Hide panel" : "Show panel", () => {
        state.objectRailOpen = !state.objectRailOpen;
        renderCenter();
        renderChrome();
      }, state.objectRailOpen),
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
      el("span", { class: "nu-accent-dot nu-brand-dot" }),
    ),
  );
  chrome.appendChild(
    chromeBtn(getMode() === "dark" ? "brightness-high" : "moon-stars", getMode() === "dark" ? "Light mode" : "Dark mode", () =>
      setMode(getMode() === "dark" ? "light" : "dark"),
    ),
  );
  chrome.appendChild(el("span", { class: "nu-topbar-div" }));
  chrome.appendChild(
    chromeBtn("bag", "Store", () => navigate(currentApp() === "store" ? "workspace" : "store"), state.page === "store"),
  );
  const isSettings = !!state.contextObject && "type" in state.contextObject && state.contextObject.type === "settings";
  chrome.appendChild(chromeBtn("gear", "Settings", openSettings, isSettings));
  const isProfile = !!state.contextObject && "type" in state.contextObject && state.contextObject.type === "user" && !!(state.contextObject as { self?: boolean }).self;
  const initials = el("span", { class: "nu-me-initials" }, meRecord().name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2));
  const avatarUrl = state.viewAs ? null : auth.identity?.avatar_url;
  const meFace = avatarUrl
    ? el("img", { class: "nu-me-img", src: avatarUrl, alt: "", referrerpolicy: "no-referrer", onerror: (e: Event) => (e.target as HTMLElement).replaceWith(initials) })
    : initials;
  chrome.appendChild(
    el(
      "button",
      { class: `nu-topbar-me${isProfile ? " is-active" : ""}`, title: "Your profile", "aria-label": "Profile", onclick: openProfile },
      meFace,
    ),
  );
  topbar.appendChild(chrome);
  impRail.update(impRailCfg());
}

function renderCenter(): void {
  /* app-surface visibility belongs to showApp (shell/apps.ts) — this render
     only owns the panel-chrome flags around the center. */
  const hideCenter = state.contextExpanded;
  objectRailHost.hidden = hideCenter || !state.objectRailOpen;
  centerHost.hidden = hideCenter;
}

function renderContext(): void {
  context.update(contextCfg());
}
function renderObjectRail(): void {
  objectRail.update(objectRailCfg());
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
  renderObjectRail();
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
initRouter("workspace");
renderChrome();
renderCenter();
state.contextObject = buildLive(state.tenantId).objects.find((o) => o.type === "artist") ?? null;
renderContext();
loadFeed(state.tenantId);

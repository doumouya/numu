/* numu-sim.d.ts — ambient types over the VERBATIM sim globals (web/sim/*.js,
   design-synced — see docs/frontend/DESIGN-SYNC.md). This file is the typed
   face of the seam: web/src talks ONLY to these shapes, so phase B (the Rust
   api behind the http driver) is a driver swap, not an app change.
   Ambient (no imports/exports) — every name here is global to web/src. */

/* ── feed blocks (the conversation vocabulary) ─────────────────────────── */

interface NumuEmailAttachment {
  name: string;
  size: string;
  rows: string;
  saved?: boolean;
}

interface NumuEmailBlock {
  type: "email";
  from: string;
  subject: string;
  time: string;
  text: string;
  attachment?: NumuEmailAttachment;
}

interface NumuStepBlock {
  type: "step";
  nacl: string;
  kind: string;
  impact: string;
}

interface NumuDataColumn {
  name: string;
  /** untruncated column name (profileBlock ellipsizes `name` at 22 chars) */
  full?: string;
  dtype: string;
  nullPct: string;
}

interface NumuDataBlock {
  type: "data";
  name: string;
  source: string;
  rows: string;
  cols: string;
  nulls: string;
  junk: string;
  cleanness?: number;
  fileId?: string;
  columns: NumuDataColumn[];
}

interface NumuChartSpec {
  nacl: string;
  type: string;
  cats: Array<{ label: string; value: number }>;
}

interface NumuDashboardBlock {
  type: "dashboard";
  name: string;
  charts: NumuChartSpec[];
}

interface NumuObjectBlock {
  type: "object";
  objType: string;
  objIcon: string;
  accentColor: string;
  title: string;
  meta: string;
  objRef?: string;
  status?: string;
}

/** multi-row read result — one clickable row per reachable entity */
interface NumuObjectTableRow {
  id: string;
  title: string;
  status: string;
  meta: string;
  objRef?: string;
}

interface NumuObjectTableBlock {
  type: "objectTable";
  objType: string;
  icon?: string;
  title: string;
  rows: NumuObjectTableRow[];
}

interface NumuBubbleBlock {
  type: "sent" | "bubble";
  text: string;
  channel?: string;
  author?: string;
  time?: string;
  react?: string;
  clientTag?: string;
  clientColor?: string;
}

type NumuBlock =
  | NumuEmailBlock
  | NumuStepBlock
  | NumuDataBlock
  | NumuDashboardBlock
  | NumuObjectBlock
  | NumuObjectTableBlock
  | NumuBubbleBlock;

/* ── nacl execution ────────────────────────────────────────────────────── */

interface NumuNaclCtx {
  actor?: string;
  workspace?: string;
  projectId?: string;
  itFileId?: string;
  channel?: string;
}

interface NumuEffect {
  kind: "theme" | "closePanel" | "play" | "it" | "needBlob" | "openObjectId";
  value?: string;
  attr?: string;
  id?: string;
  query?: string;
  volume?: string;
}

interface NumuNaclResult {
  blocks: NumuBlock[];
  effects: NumuEffect[];
}

/* ── the CSV upload envelope (POST /api/files · engine.uploadCsv) ──────── */

interface NumuColumnMeta {
  name: string;
  dtype: string;
  semantic_dtype: string;
  null_pct: number;
  [k: string]: unknown;
}

interface NumuUploadOut {
  rid: string;
  filename: string;
  encoding: string;
  cleanness: number;
  fully_null_rows: number;
  row_count: number;
  col_count: number;
  columns: NumuColumnMeta[];
  wrapped?: boolean;
}

interface NumuResponse<B = unknown> {
  status: number;
  body: B;
  headers?: Record<string, string | null>;
}

/* ── the sim engine surface the shell reads (LOCAL driver only — the http
      driver's `engine` is undefined and the server enforces reach) ──────── */

interface NumuEntity {
  id: string;
  type: string;
  data: Record<string, unknown> & { attributes?: Record<string, unknown> };
  scope_parent_id: string | null;
  version: number;
}

interface NumuSimEngine {
  state: {
    entities: Record<string, NumuEntity>;
    /** context_role is a cosmetic label (never enforcement — rbac doctrine) */
    memberships: Array<{ object_id: string; member_id: string; role: string; context_role?: string | null }>;
  };
  reachable(actor: string, type: string | null): NumuEntity[];
  scopeChain(id: string): string[];
  principals(actor: string): string[];
  isPlatformAdmin(actor: string): boolean;
  event(entityId: string, actor: string, kind: string, payload?: unknown): void;
}

/* ── the client seam (sim/numu-client.js — local ⇄ http drivers) ───────── */

interface NumuClientApi {
  kind: "local" | "http";
  /** the acting user — impersonation swaps this (operator view-as) */
  actor: string;
  /** local driver only — the in-process engine */
  engine?: NumuSimEngine;
  ensureBlob(fileId: string): Promise<boolean>;
  request(
    method: string,
    path: string,
    opts?: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> },
  ): Promise<NumuResponse>;
  nacl(text: string, ctx: NumuNaclCtx): Promise<NumuNaclResult>;
  uploadCsv(
    projectId: string,
    filename: string,
    csvText: string,
    srcUrl?: string,
  ): Promise<NumuResponse<NumuUploadOut>>;
  feed(key: string): Promise<NumuBlock[]>;
  appendFeed(key: string, blocks: NumuBlock[]): Promise<unknown>;
  setFeed?(key: string, blocks: NumuBlock[]): Promise<unknown>;
  manifest(workspace: string): Promise<unknown>;
  values(fileId: string, col: string): Promise<string[]>;
  reset?(): void;
}

/* ── console demo data (web/data/console-data.js, design-synced) ───────── */

interface ConsoleTenant {
  id: string;
  mark: string;
  name: string;
  sub: string;
  accent: string;
  active?: boolean;
}

interface ConsoleChannel {
  id: string;
  name: string;
  icon: string;
  system?: boolean;
  collapsed?: boolean;
  hidden?: boolean;
}

interface ConsoleProject {
  id: string;
  name: string;
  mark?: string;
  icon?: string;
  color: string;
  channel: string;
  pinned?: boolean;
  active?: boolean;
}

interface ConsoleObject {
  id: string;
  type: string;
  name: string;
  icon: string;
  accent: string;
  meta?: string;
  artist?: string;
  artistId?: string;
  album?: string;
  year?: string;
  no?: number;
  cover?: string | null;
  src?: string;
  autoplay?: boolean;
  duration?: string;
  pos?: string;
  posPct?: number;
  gallery?: number;
  code?: string;
  status?: string;
  fields?: Array<[string, string]>;
  /** a long markdown body (article/site_copy content) rendered as prose, not a raw field. */
  bodyMd?: string;
  charts?: NumuChartSpec[];
  /** artist grouping (buildLive) */
  plays?: string;
  tracks?: ConsoleObject[];
  albums?: Array<{ title: string; year?: string; cover?: string | null }>;
  /** enriched case detail (recordFromRef) */
  caseType?: string;
  priority?: string;
  origin?: string;
  classification?: string;
  assignee?: string | null;
  reporter?: string | null;
  project?: string;
  workflowId?: string;
  wfStates?: string[] | null;
  description?: string;
  version?: number;
}

interface ConsoleConnector {
  id: string;
  name: string;
  icon: string;
  img?: string;
  color: string;
  kind: string;
  connected?: boolean;
  /** console v2 (HTTP mode): no live integration yet — "coming soon", no Connect action. */
  soon?: boolean;
  local?: boolean;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  ssl?: string;
  store?: string;
  tables?: string;
  account?: string;
  scopes?: string;
  lastSync?: string;
}

interface ConsoleStoreApp {
  id: string;
  name: string;
  cat: string;
  icon?: string;
  img?: string;
  accent: string;
  installed?: boolean;
  enabled?: boolean;
  claude?: boolean;
  badge?: string;
  src?: string;
  tagline: string;
  about?: string[];
  /** console v2 (HTTP mode): a catalog item with no live surface yet — the
      Store renders "coming soon" and offers no install action. */
  soon?: boolean;
}

interface ConsoleUserRecordData {
  id: string;
  type: "user";
  name: string;
  handle: string;
  /** actor name parts (0022) — HTTP mode; sim leaves them unset (display name is the canon). */
  firstName?: string;
  lastName?: string;
  email: string;
  phone: string;
  country: string;
  kind: "human" | "agent" | "service";
  status: string;
  role: string;
  accent: string;
  joined: string;
  lastActive: string;
  timezone: string;
  locale: string;
  legalName?: string;
  self?: boolean;
  notes: string;
  kyc: { status: string; method: string; date: string };
  memberships: Array<{ org: string; team: string; role: string }>;
  activity: Array<{ icon: string; text: string; time: string }>;
  owned: Array<{ objType: string; name: string; meta: string; icon: string; accent: string }>;
  sessions?: Array<{ device: string; os: string; where: string; ip: string; last: string; current?: boolean }>;
}

interface ConsoleSkin {
  id: string;
  name: string;
  desc: string;
  mode: "dark" | "light";
  theme: "numu" | "numu-blue";
  skin: string;
  gradient?: boolean;
}

interface ConsoleSettingsData {
  workspace: { name: string; handle: string; currency: string; locale: string; timezone: string; region: string };
  currencies: string[];
  locales: string[];
  skins: ConsoleSkin[];
  aiConnect: Array<{ id: string; name: string; vendor: string; icon?: string; img?: string; connected: boolean; plan?: string; note: string }>;
  plans: Array<{ id: string; name: string; price: string; per: string; current?: boolean; features: string[] }>;
  appScopes: Array<{ id: string; label: string; desc: string }>;
  notifications: Array<{ id: string; label: string; desc: string; on: boolean }>;
}

interface ConsoleTenantData {
  overview: { id: string; icon: string; name: string };
  naclHint: string;
  channels: ConsoleChannel[];
  projects: ConsoleProject[];
  objects: ConsoleObject[];
  suggestions: Array<{ text: string }>;
  feed: NumuBlock[];
}

interface ConsoleData {
  me: { name: string; initials: string; role: string };
  tenants: ConsoleTenant[];
  composerChannels: Array<{ id: string; icon: string; label: string }>;
  connectors: Array<{ group: string; items: ConsoleConnector[] }>;
  apps: ConsoleStoreApp[];
  agents: ConsoleStoreApp[];
  userOrder: string[];
  users: Record<string, ConsoleUserRecordData>;
  settings: ConsoleSettingsData;
  data: Record<string, ConsoleTenantData>;
}

/* ── nacl doctrine catalog (web/data/nacl-commands.js, design-synced) ──── */

interface NaclCatalogObject {
  id: string;
  kind: string;
  via?: string;
  source?: string;
}

interface NaclCommands {
  objects: NaclCatalogObject[];
  [k: string]: unknown;
}

/* ── the registry seed (web/sim/numu-seed.js, design-synced) ───────────── */

interface NumuSeedData {
  ENTITIES: Array<[string, string, Record<string, unknown>, string | null]>;
  WORKFLOWS: Record<string, { states: string[]; initial: string; close_checks: string[]; rejects?: string[] }>;
  ROLES: Record<string, number>;
}

/* ── the globals the plain <script> tags install ───────────────────────── */

interface Window {
  NUMU_HTTP?: boolean;
  NumuClient: {
    local(): NumuClientApi;
    http(base: string): NumuClientApi;
  };
  numuClient?: NumuClientApi;
  NumuNacl: {
    exec(engine: unknown, ctx: NumuNaclCtx, text: string): NumuNaclResult;
    clauses(text: string): unknown[];
    profileBlock(name: string, source: string, out: NumuUploadOut): NumuDataBlock;
  };
  NumuSeed?: NumuSeedData;
  NACL_COMMANDS: NaclCommands;
  CONSOLE_DATA: ConsoleData;
  /** the full Bootstrap Icons name list (web/data/bi-icon-names.js, synced) */
  BI_ICON_NAMES?: string[];
  /** window-global values cache the autocomplete's lazy field-domain plane fills */
  __NUMU_VALUES?: Record<string, Record<string, string[]>>;
  echarts?: {
    init(el: HTMLElement): {
      setOption(option: unknown): void;
      resize(): void;
      dispose(): void;
    };
  };
}

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

/* ── the client seam (sim/numu-client.js — local ⇄ http drivers) ───────── */

interface NumuClientApi {
  kind: "local" | "http";
  actor: string;
  /** local driver only — the in-process engine (used by tests, never the UI) */
  engine?: unknown;
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
}

interface ConsoleProject {
  id: string;
  name: string;
  mark: string;
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
  duration?: string;
  pos?: string;
  posPct?: number;
  gallery?: number;
  code?: string;
  status?: string;
  fields?: Array<[string, string]>;
  charts?: NumuChartSpec[];
  src?: string;
}

interface ConsoleConnector {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: string;
  connected?: boolean;
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
  NACL_COMMANDS: NaclCommands;
  CONSOLE_DATA: ConsoleData;
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

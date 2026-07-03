/* nacl-suggest.ts — the staged nacl autocomplete, a PURE port of the design
   project's naclSuggest (ui_kits/console/ConsoleFeed.jsx): verb → object →
   column → operator → value, real-time on the last token. Objects are
   rbac-scoped (the doctrine catalog + this thread's materialized csvs only);
   csv columns come from the profile blocks in the feed; values go field-domain
   first and quote themselves (spaces/commas → "…") per the nacl doctrine.

   Pure: no window, no DOM — every plane is a parameter, so node --test covers
   the staging logic (web/tests/nacl-suggest.test.ts). The composer adapts the
   live planes (feed · window.__NUMU_VALUES · window.NACL_COMMANDS) into args. */

export interface SuggestItem {
  /** the text that replaces the current token on accept */
  insert: string;
  /** the display label */
  label: string;
  /** the muted right-hand hint (provenance / SQL meaning) */
  hint: string;
}

export interface SuggestResult {
  items: SuggestItem[];
  /** the token being completed (the composer splices it out on accept) */
  tok: string;
}

/** a materialized csv visible to this thread (derived from feed data blocks) */
export interface SuggestFile {
  /** file name without the .csv suffix */
  name: string;
  fileId?: string;
  /** untruncated column names */
  cols: string[];
}

/** column-distinct values per fileId per lowercased column name */
export type ValuesCache = Record<string, Record<string, string[]>>;

const VERBS = ["read", "new", "set", "del", "on", "post", "play"] as const;
const VERB_HINTS: Record<string, string> = {
  read: "SELECT",
  new: "INSERT",
  set: "UPDATE",
  del: "DELETE",
  on: "loop · for-each match",
  post: "write back · UPSERT",
  play: "media",
};

/** the demo field-domain plane (settings + registry enums the doctrine names) */
const DOM: Record<string, string[]> = {
  region: ["EMEA", '"Île-de-France"', '"Val de Marne"', "AMER"],
  plan: ["pro", "free", "scale"],
  status: ["open", "in_review", "done"],
  theme: ["dark", "light"],
  tone: ["slate", "graphite", "carbon", "sandstone"],
  lang: ["en", "fr"],
  role: ["owner", "admin", "member"],
  city: ["Paris", "London"],
  country: ["France", "England"],
  type: ["mp3", "wav", "mp4", "csv"],
  mode: ["dark", "light"],
  accent: ["ink", "blue"],
  volume: ["10", "50", "100"],
};

/** generic registry columns per object (until the manifest plane serves them) */
const GEN: Record<string, string[]> = {
  case: ["id", "status", "priority", "owner", "opened"],
  user: ["id", "email", "role", "handle", "status", "kyc"],
  customer: ["id", "name", "region", "mrr", "plan"],
  email: ["id", "from", "subject"],
  settings: ["theme", "tone", "lang", "density"],
  file: ["name", "type", "city", "country"],
  theme: ["mode", "accent"],
};

export function naclSuggest(
  text: string,
  files: SuggestFile[],
  values: ValuesCache = {},
  catalog: NaclCatalogObject[] = [],
): SuggestResult | null {
  if (!text) return null;
  const tok = (/(?:\S*(?:"[^"]*"?|'[^']*'?)|\S*)$/.exec(text) ?? [""])[0];
  if (!tok) return null;

  const items: SuggestItem[] = [];
  const push = (insert: string, label: string, hint?: string): void => {
    if (items.length < 7 && !items.some((i) => i.insert === insert)) {
      items.push({ insert, label, hint: hint ?? "" });
    }
  };
  const done = (): SuggestResult | null => (items.length ? { items, tok } : null);

  const ci = tok.indexOf(":");

  /* ── stage 1 · the verb ── */
  if (ci === -1) {
    VERBS.forEach((v) => {
      if (v.indexOf(tok.toLowerCase()) === 0) push(v + ":", v + ":", VERB_HINTS[v]);
    });
    return done();
  }

  const verb = tok.slice(0, ci).toLowerCase();
  const rest = tok.slice(ci + 1);
  const opM = /(!=|>=|<=|=|>|<)/.exec(rest);
  const di = rest.indexOf(".");

  /* ── stage 4 · the value (after an operator) ── */
  if (opM) {
    const op = opM[1] ?? "";
    const field = (rest.slice(0, opM.index).split(".").pop() ?? "").toLowerCase();
    const typed = rest.slice(opM.index + op.length).toLowerCase();
    const base = tok.slice(0, tok.length - (rest.length - opM.index - op.length));
    (DOM[field] ?? []).forEach((v) => {
      if (!typed || v.toLowerCase().indexOf(typed) === 0) push(base + v, base + v, "field domain");
    });
    files.forEach((f) => {
      const bag = f.fileId ? values[f.fileId] : undefined;
      (bag?.[field] ?? []).forEach((v) => {
        const ins = /[\s,]/.test(v) ? '"' + v + '"' : v;
        if (!typed || v.toLowerCase().indexOf(typed) === 0) {
          push(base + ins, base + v, "column-distinct · " + f.name);
        }
      });
    });
    if (field === "name") {
      files.forEach((f) => {
        if (!typed || f.name.indexOf(typed) === 0) push(base + f.name, base + f.name, "thread csv");
      });
    }
    return done();
  }

  /* ── stage 3 · the column (after object.) ── */
  if (di !== -1) {
    const obj = rest.slice(0, di).toLowerCase();
    const typed = rest.slice(di + 1).toLowerCase();
    const base = verb + ":" + rest.slice(0, di) + ".";
    const file = files.find((f) => f.name.toLowerCase() === obj);
    const cols = file
      ? file.cols
      : obj === "file" && files[0]
        ? (GEN["file"] ?? []).concat(files[0].cols)
        : (GEN[obj] ?? []);
    cols.forEach((c) => {
      if (!typed || c.toLowerCase().indexOf(typed) === 0) {
        push(base + c + "=", base + c, file ? "column · " + obj + ".csv" : "column");
      }
    });
    return done();
  }

  /* ── stage 2 · the object ── */
  const typed = rest.toLowerCase();
  if (verb === "set") {
    ["theme", "tone", "lang", "density", "volume"].forEach((a) => {
      if (!typed || a.indexOf(typed) === 0) push("set:" + a + "=", "set:" + a, "settings · no page");
    });
  }
  if ((verb === "read" || verb === "list") && "users".indexOf(typed) === 0) {
    push(verb + ":users", verb + ":users", "everyone you can reach");
  }
  files.forEach((f) => {
    if (!typed || f.name.indexOf(typed) === 0) {
      push(verb + ":file.name=" + f.name, verb + ":file.name=" + f.name, "thread csv · on device");
    }
  });
  if ((verb === "read" || verb === "play" || verb === "del") && (!typed || "file".indexOf(typed) === 0)) {
    push(verb + ":file.", verb + ":file", "by attribute");
  }
  catalog.forEach((o) => {
    if (!typed || o.id.indexOf(typed) === 0) {
      push(
        verb + ":" + o.id + (o.kind === "data" ? "." : " "),
        verb + ":" + o.id,
        (o.kind !== "data" ? o.kind + " · " : "") + (o.via ?? o.source ?? ""),
      );
    }
  });
  return done();
}

/** Derive the thread's materialized-csv plane from the feed (profile blocks). */
export function filesFromFeed(feed: NumuBlock[]): SuggestFile[] {
  return feed
    .filter((b): b is NumuDataBlock => b.type === "data")
    .map((f) => ({
      name: f.name.replace(/\.csv$/i, ""),
      fileId: f.fileId,
      cols: (f.columns ?? []).map((c) => c.full ?? c.name),
    }));
}

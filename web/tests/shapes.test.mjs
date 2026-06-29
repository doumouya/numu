// CASE 0013 — HttpClient shape-normalization unit tests (AC4–AC8 unit halves).
// =============================================================================
// Verification path per spec: [JS-UNIT] for the HttpClient shape maps (G3–G7) +
// the makeClient("auto") regression guard. No Rust test exists for these.
//
// Harness: web/numu-data-client.js is a browser IIFE that references `window`
// and `fetch`. We read its text, shim a `window` global, execute it so that
// `window.NUMU_CLIENT` populates, then grab HttpClient / FixtureClient / AutoClient.
// We monkeypatch HttpClient.prototype._get / _send (NOT real fetch) to return
// recorded backend JSON, call the public methods, and assert the NORMALIZED output
// the fixture-built UI consumes.
//
// RED EXPECTATION (today, against the just-copied production file):
//   AC4 list      FAIL  (HttpClient.list returns raw {items,limit,offset})
//   AC5 item      FAIL  (get/create/update return raw {id,type,data,version,etag})
//   AC6 types/opt FAIL  (returns raw snake_case, not camelCase)
//   AC7 convos    FAIL  (channel is raw data.channel_group ⇒ undefined when absent,
//                        not the "Clients" fallback; and it.data.title throws on data:null
//                        — no `it.data || {}` guard yet)
//   AC8 unit      PASS  (makeClient("auto") already returns AutoClient — GUARD, not red)
// Coder makes AC4–AC7 green by adding a shared flatten() + per-method mapping.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(__dirname, "..", "numu-data-client.js");

// ── load the production client in a Node context ────────────────────────────
function loadClient() {
  const src = readFileSync(CLIENT_PATH, "utf8");
  const win = {};
  // The IIFE assigns to `window.NUMU_CLIENT`. Every HttpClient shape test
  // monkeypatches _get/_send, so HttpClient never reaches this fetch. The one
  // legitimate caller is AutoClient's constructor probe of /api/health (line ~308):
  // return a REJECTED promise so it lands in the constructor's `.catch` (offline =
  // self.live=false) instead of throwing synchronously. This keeps the AC8 guard
  // honest: makeClient("auto") must construct an AutoClient without exploding.
  const sandboxFetch = function () {
    return Promise.reject(new Error("offline (sandbox fetch — patch _get/_send for shape tests)"));
  };
  // Execute the IIFE with `window` + `fetch` + `FormData` in scope.
  // eslint-disable-next-line no-new-func
  new Function("window", "fetch", "FormData", src)(win, sandboxFetch, function () {});
  if (!win.NUMU_CLIENT) throw new Error("NUMU_CLIENT did not populate window");
  return win.NUMU_CLIENT;
}

const NUMU = loadClient();
const { HttpClient, FixtureClient, AutoClient } = NUMU;

// A scoped HttpClient whose network seams are replaced by canned responses.
// `getResponses` maps a path → JSON the backend would return from _get.
// `sendResponse` is returned from any _send call (POST/PATCH).
function stubbedHttp({ getByPath = {}, getDefault, sendResponse } = {}) {
  const c = new HttpClient();
  c._get = function (path) {
    if (Object.prototype.hasOwnProperty.call(getByPath, path)) {
      return Promise.resolve(getByPath[path]);
    }
    // match ignoring query string
    const bare = path.split("?")[0];
    if (Object.prototype.hasOwnProperty.call(getByPath, bare)) {
      return Promise.resolve(getByPath[bare]);
    }
    if (getDefault !== undefined) return Promise.resolve(getDefault);
    return Promise.reject(new Error("no stub for _get " + path));
  };
  c._send = function () {
    if (sendResponse !== undefined) return Promise.resolve(sendResponse);
    return Promise.reject(new Error("no stub for _send"));
  };
  return c;
}

// ── tiny runner: one line per AC, non-zero exit on any failure ──────────────
const results = [];
async function ac(label, fn) {
  try {
    await fn();
    results.push({ label, ok: true });
    console.log("PASS  " + label);
  } catch (e) {
    results.push({ label, ok: false, err: e });
    console.log("FAIL  " + label + "  —  " + (e && e.message));
  }
}

// ── AC4 (G3 — list shape) ───────────────────────────────────────────────────
// _get → {items:[<entity_json>], limit, offset}
//   ⇒ list() → {rows:[<flat>], total: items.length}, flat per the G4 rule.
await ac("AC4 list — {items,limit,offset} ⇒ {rows:[flat], total}", async () => {
  const backend = {
    items: [
      { id: "FIL_d055", type: "file", data: { filename: "dossier.csv", cleanness: 62 }, version: 1, etag: 'W/"1"' },
      { id: "FIL_7e2c", type: "file", data: { filename: "temps.csv", cleanness: 94 }, version: 2, etag: 'W/"2"' },
    ],
    limit: 50,
    offset: 0,
  };
  const c = stubbedHttp({ getByPath: { "/api/objects/file": backend } });
  const out = await c.list("file", {});

  assert.ok(out && typeof out === "object", "list() returns an object");
  assert.ok(Array.isArray(out.rows), "list() result has a `rows` array");
  assert.equal(out.total, backend.items.length, "total === items.length (page count)");
  // rows must be FLATTENED entity rows (G4 rule), not the raw envelope items.
  assert.deepEqual(out.rows[0], {
    id: "FIL_d055",
    type: "file",
    filename: "dossier.csv",
    cleanness: 62,
    _version: "1",
  }, "rows[0] is the flattened {id,type,...data,_version:String}");
  assert.equal(out.rows[1]._version, "2", "rows[1]._version is the stringified version");
  // must NOT leak the raw envelope keys
  assert.equal(out.items, undefined, "no raw `items` leaks through");
  assert.equal(out.rows[0].data, undefined, "no nested `data` leaks through");
  assert.equal(out.rows[0].version, undefined, "no numeric `version` leaks through");
});

// ── AC5 (G4 — item shape / flatten) ──────────────────────────────────────────
// _get/_send → {id,type,data:{…},version:3,etag}
//   ⇒ get/create/update → {id,type,...data,_version:"3"} (_version is a STRING).
await ac("AC5 item — {id,type,data,version,etag} ⇒ {id,type,...data,_version:String}", async () => {
  const envelope = {
    id: "FIL_d055",
    type: "file",
    data: { filename: "dossier.csv", encoding: "windows-1252", cleanness: 62 },
    version: 3,
    etag: 'W/"3"',
  };
  const expected = {
    id: "FIL_d055",
    type: "file",
    filename: "dossier.csv",
    encoding: "windows-1252",
    cleanness: 62,
    _version: "3",
  };

  // get()
  const cg = stubbedHttp({ getByPath: { "/api/objects/file/FIL_d055": envelope } });
  const got = await cg.get("file", "FIL_d055");
  assert.deepEqual(got, expected, "get() returns the flattened row");
  assert.equal(typeof got._version, "string", "_version is a string (matches FixtureClient)");

  // create()
  const cc = stubbedHttp({ sendResponse: envelope });
  const created = await cc.create("file", { filename: "dossier.csv" });
  assert.deepEqual(created, expected, "create() returns the flattened row");

  // update()
  const cu = stubbedHttp({ sendResponse: envelope });
  const updated = await cu.update("file", "FIL_d055", { cleanness: 62 }, "2");
  assert.deepEqual(updated, expected, "update() returns the flattened row");
  assert.equal(updated.data, undefined, "no nested `data` leaks through on update");
});

// ── AC6 (G5 — types/options casing) ───────────────────────────────────────────
// snake_case in ⇒ camelCase out; `fields` passed through unchanged.
await ac("AC6 types/options — snake_case ⇒ camelCase, fields passthrough", async () => {
  // types(): backend GET /api/types → {types:[{type_id,id_prefix,display_name,...,context_view},…]}
  const typesBackend = {
    types: [
      {
        type_id: "file",
        id_prefix: "FIL",
        display_name: "File",
        display_name_plural: "Files",
        context_view: "table",
        scope_parents: ["project_id"],
        is_builtin: true,
      },
    ],
  };
  const ct = stubbedHttp({ getByPath: { "/api/types": typesBackend } });
  const types = await ct.types();
  const t0 = Array.isArray(types) ? types[0] : (types.types && types.types[0]);
  assert.ok(t0, "types() yields at least one entry");
  assert.equal(t0.type, "file", "type_id ⇒ type");
  assert.equal(t0.idPrefix, "FIL", "id_prefix ⇒ idPrefix");
  assert.equal(t0.displayName, "File", "display_name ⇒ displayName");
  assert.equal(t0.displayNamePlural, "Files", "display_name_plural ⇒ displayNamePlural");
  assert.equal(t0.contextView, "table", "context_view ⇒ contextView");
  assert.deepEqual(t0.scopeParents, ["project_id"], "scope_parents ⇒ scopeParents");
  assert.equal(t0.type_id, undefined, "raw snake type_id must not leak");
  assert.equal(t0.context_view, undefined, "raw snake context_view must not leak");

  // options(type): backend GET /api/types/:type → full descriptor (snake) with `fields`.
  const optionsBackend = {
    type_id: "file",
    id_prefix: "FIL",
    display_name: "File",
    display_name_plural: "Files",
    context_view: "table",
    scope_parents: ["project_id"],
    is_builtin: true,
    method_policy: {},
    fields: [
      { field: "filename", label: "Filename", kind: "text", required: true, editable: false, options: { role: "title" } },
      { field: "cleanness", label: "Cleanness", kind: "int", required: false, editable: false, options: { role: "metric" } },
    ],
  };
  const co = stubbedHttp({ getByPath: { "/api/types/file": optionsBackend } });
  const opt = await co.options("file");
  assert.equal(opt.type, "file", "options(): type_id ⇒ type");
  assert.equal(opt.idPrefix, "FIL", "options(): id_prefix ⇒ idPrefix");
  assert.equal(opt.displayName, "File", "options(): display_name ⇒ displayName");
  assert.equal(opt.displayNamePlural, "Files", "options(): display_name_plural ⇒ displayNamePlural");
  assert.equal(opt.contextView, "table", "options(): context_view ⇒ contextView");
  assert.deepEqual(opt.scopeParents, ["project_id"], "options(): scope_parents ⇒ scopeParents");
  // fields passed through unchanged (incl. options.role)
  assert.deepEqual(opt.fields, optionsBackend.fields, "options(): fields passed through unchanged");
  assert.equal(opt.fields[0].options.role, "title", "options(): field options.role preserved");
});

// ── AC7 (G6 — conversations mapping) ──────────────────────────────────────────
// project envelope {items:[{id,type,data:{name,origin,status,…},version,etag}]}
//   ⇒ [{id, title:data.title||data.name, origin, channel, status}]
// CONTRACT (orchestrator review): (1) `channel` falls back to "Clients" when the
// item's data has NO `channel_group` — the LIVE project type has no such field, so
// without the fallback every live conversation groups under `undefined`. A present
// `channel_group` still passes through. (2) `conversations()` must guard a missing
// `data` (live can't produce it, but the test proves robustness): `const d=it.data||{}`
// so a `data:null` item yields a sane row instead of throwing.
await ac("AC7 conversations — project envelope ⇒ [{id,title,origin,channel,status}]", async () => {
  const projectBackend = {
    items: [
      // (a) live-shaped: NO channel_group ⇒ channel falls back to "Clients".
      { id: "PRJ_3f21", type: "project", data: { name: "Client cleanup — Maison Rets", origin: "email", status: "active" }, version: 1, etag: 'W/"1"' },
      // (b) HAS channel_group ⇒ that value passes through; data.title wins over data.name.
      { id: "PRJ_0c14", type: "project", data: { title: "Internal — fleet health", name: "ignored-name", origin: "manual", status: "active", channel_group: "Internal" }, version: 2, etag: 'W/"2"' },
      // (c) robustness: data is null ⇒ must NOT throw; sane defaults (channel "Clients", title undefined).
      { id: "PRJ_null", type: "project", data: null, version: 3, etag: 'W/"3"' },
    ],
    limit: 50,
    offset: 0,
  };
  // conversations() hits /api/objects/project (+ harmless ?origin=…); match on bare path.
  const c = stubbedHttp({ getByPath: { "/api/objects/project": projectBackend } });
  const convos = await c.conversations();

  assert.ok(Array.isArray(convos), "conversations() returns an array");
  assert.equal(convos.length, 3, "one projection per project item");
  // (a) no channel_group ⇒ channel falls back to "Clients" (fixture default for the live project type).
  assert.deepEqual(convos[0], {
    id: "PRJ_3f21",
    title: "Client cleanup — Maison Rets",
    origin: "email",
    channel: "Clients",
    status: "active",
  }, "convos[0]: title falls back to data.name; channel falls back to \"Clients\" when no channel_group");
  // (b) data.title wins over data.name; a present channel_group passes through unchanged.
  assert.equal(convos[1].title, "Internal — fleet health", "title = data.title || data.name (title wins)");
  assert.equal(convos[1].origin, "manual", "origin = data.origin");
  assert.equal(convos[1].channel, "Internal", "channel = data.channel_group when present (passthrough)");
  assert.equal(convos[1].status, "active", "status = data.status");
  // (c) data:null robustness — does not throw; channel defaults to "Clients", title undefined.
  assert.equal(convos[2].id, "PRJ_null", "convos[2]: id still maps from the envelope when data is null");
  assert.equal(convos[2].title, undefined, "convos[2]: title is undefined when data is null (no name/title)");
  assert.equal(convos[2].channel, "Clients", "convos[2]: channel falls back to \"Clients\" when data is null");
  // must NOT leak the raw envelope
  assert.equal(convos[0].items, undefined, "no raw `items` leaks through");
  assert.equal(convos[0].data, undefined, "no nested `data` leaks through");
});

// ── AC8 (unit half — makeClient("auto")) — REGRESSION GUARD, not a red ────────
// makeClient("auto") ALREADY returns an AutoClient (numu-data-client.js:322-326);
// this MUST PASS today and keep passing. It guards the coder against breaking the
// working override while wiring G7.
await ac("AC8 unit — makeClient(\"auto\") returns an AutoClient [GUARD]", async () => {
  const client = NUMU.makeClient("auto");
  assert.ok(client instanceof AutoClient, "makeClient('auto') is an AutoClient instance");
  // sanity: "http" and "fixture" still resolve to their respective impls
  assert.ok(NUMU.makeClient("http") instanceof HttpClient, "makeClient('http') is an HttpClient");
  assert.ok(NUMU.makeClient("fixture") instanceof FixtureClient, "makeClient('fixture') is a FixtureClient");
});

// ── summary + exit code ──────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log("");
console.log("CASE 0013 shapes: " + (results.length - failed.length) + "/" + results.length + " passed");
if (failed.length) {
  console.log("FAILED: " + failed.map((r) => r.label).join(" | "));
  process.exit(1);
}
process.exit(0);

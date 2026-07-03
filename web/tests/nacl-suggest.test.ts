// nacl-suggest.test.ts — the staged autocomplete's staging logic, pure (no DOM):
// verb → object → column → operator → value, quoting, domain-first ordering.
// Run: node --test web/tests/   (node strips the types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import { naclSuggest, filesFromFeed } from "../src/console/nacl-suggest.ts";

const dossier = {
  name: "dossier",
  fileId: "FIL_1",
  cols: ["id", "customer", "region", "plan", "mrr"],
};
const CATALOG = [
  { id: "case", kind: "data", source: "registry" },
  { id: "email", kind: "channel", via: "gmail" },
];

test("verb stage: a bare prefix proposes verbs with their SQL hints", () => {
  const r = naclSuggest("re", []);
  assert.ok(r, "suggestions for 're'");
  assert.equal(r.items[0]?.insert, "read:");
  assert.equal(r.items[0]?.hint, "SELECT");
});

test("verb stage: no match → null (never an empty popover)", () => {
  assert.equal(naclSuggest("zz", []), null);
});

test("object stage: thread csvs surface as read:file.name=<name>", () => {
  const r = naclSuggest("read:dos", [dossier]);
  assert.ok(r);
  assert.ok(
    r.items.some((i) => i.insert === "read:file.name=dossier"),
    "the materialized csv is proposed by name",
  );
});

test("object stage: the doctrine catalog is rbac-scope-shaped (data objects get a dot)", () => {
  const r = naclSuggest("read:ca", [], {}, CATALOG);
  assert.ok(r);
  const item = r.items.find((i) => i.label === "read:case");
  assert.ok(item, "catalog object proposed");
  assert.equal(item.insert, "read:case.", "data-kind objects continue with a dot");
});

test("column stage: object.prefix completes the csv's real columns with '='", () => {
  const r = naclSuggest("read:dossier.re", [dossier]);
  assert.ok(r);
  assert.equal(r.items[0]?.insert, "read:dossier.region=");
  assert.equal(r.items[0]?.hint, "column · dossier.csv");
});

test("value stage: field-domain values come first", () => {
  const r = naclSuggest("read:region=", [dossier]);
  assert.ok(r);
  assert.equal(r.items[0]?.hint, "field domain");
});

test("value stage: column-distinct values self-quote when they carry spaces", () => {
  // `customer` is NOT in the demo field-domain plane, so the column-distinct
  // cache is the only source (the domain plane would dedupe a shared field).
  const values = { FIL_1: { customer: ["Anna Diallo", "Bob"] } };
  const r = naclSuggest("read:dossier.customer=", [dossier], values);
  assert.ok(r);
  const quoted = r.items.find((i) => i.label.endsWith("Anna Diallo"));
  assert.ok(quoted, "multi-word value proposed");
  assert.ok(quoted.insert.endsWith('"Anna Diallo"'), "inserted pre-quoted");
  assert.equal(quoted.hint, "column-distinct · dossier");
});

test("value stage: name= proposes the thread csvs", () => {
  const r = naclSuggest("read:file.name=", [dossier]);
  assert.ok(r);
  assert.ok(r.items.some((i) => i.hint === "thread csv"));
});

test("set verb proposes the settings plane (no settings page)", () => {
  const r = naclSuggest("set:t", []);
  assert.ok(r);
  const inserts = r.items.map((i) => i.insert);
  assert.ok(inserts.includes("set:theme="));
  assert.ok(inserts.includes("set:tone="));
});

test("only the LAST token is completed (chained clauses)", () => {
  const r = naclSuggest("read:id=345 se", []);
  assert.ok(r);
  assert.equal(r.tok, "se");
  assert.equal(r.items[0]?.insert, "set:");
});

test("filesFromFeed derives the csv plane from data blocks (untruncated cols)", () => {
  const feed = [
    { type: "email", from: "", subject: "", time: "", text: "" },
    {
      type: "data",
      name: "dossier.csv",
      source: "",
      rows: "101,234",
      cols: "17",
      nulls: "0",
      junk: "5%",
      fileId: "FIL_9",
      columns: [{ name: "cause_du_sinist…", full: "cause_du_sinistre", dtype: "string", nullPct: "0%" }],
    },
  ] as never[];
  const files = filesFromFeed(feed);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.name, "dossier");
  assert.deepEqual(files[0]?.cols, ["cause_du_sinistre"]);
});

#!/usr/bin/env node
// nacl-ref-gen — emits docs/nacl/REFERENCE.md from the design-synced canon
// (web/data/nacl-commands.js). The canon is READ ONLY (sim-verbatim); this tool
// makes the per-verb reference impossible to drift: doc-coverage-audit R5
// regenerates and diffs on every ci run. Usage:
//   node tools/nacl-ref-gen/gen.mjs           # writes docs/nacl/REFERENCE.md
//   node tools/nacl-ref-gen/gen.mjs --stdout  # prints (the audit's diff path)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const canonPath = join(root, "web", "data", "nacl-commands.js");
const outPath = join(root, "docs", "nacl", "REFERENCE.md");

// The canon assigns window.NACL_COMMANDS inside an IIFE — executed here with a stub window.
// TRUST BOUNDARY: evaluating a file is code execution, so we only ever evaluate the exact
// bytes the sim-verbatim gate pinned — the sha256 in web/.sync-manifest must match first
// (an edited canon fails here with the same re-sync instruction the gate gives).
const src = readFileSync(canonPath, "utf8");
const manifest = readFileSync(join(root, "web", ".sync-manifest"), "utf8");
const pinned = manifest
  .split("\n")
  .find((l) => l.endsWith("web/data/nacl-commands.js"))
  ?.split(/\s+/)[0];
const actual = createHash("sha256").update(src).digest("hex");
if (!pinned || pinned !== actual) {
  console.error(
    "nacl-ref-gen: web/data/nacl-commands.js does not match web/.sync-manifest — " +
      "refusing to evaluate. Fix upstream in the Design System project + re-run tools/design-sync.sh."
  );
  process.exit(1);
}
const win = {};
new Function("window", src)(win);
const { types, verbs, objects } = win.NACL_COMMANDS;

const esc = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");
const row = (cells) => `| ${cells.map(esc).join(" | ")} |`;
const verbTable = (list) => [
  "| syntax | does | example | built | args |",
  "|---|---|---|---|---|",
  ...list.map((v) =>
    row([`\`${v.syntax}\``, v.does, `\`${v.eg}\``, v.built ? "✅" : "○ wanted", (v.args || []).join(" · ") || "—"])
  ),
];

const GROUP_NOTES = {
  io: "the read/write boundary (source ⇄ csv ⇄ connector)",
  scope: "narrow to a set, name results — the loop + the safety rail",
  rows: "CRUD = SQL DML; `=`/ops mean MATCH after a read, ASSIGN after a write",
  fields: "CRUD on the schema — these ship today as the data-cleaning verbs",
  pipeline: "the positional query DSL (shape / aggregate / visualize)",
};

const lines = [];
lines.push("# nacl — the generated per-verb reference");
lines.push("");
lines.push("> **GENERATED — never hand-edit.** Source of truth: [`web/data/nacl-commands.js`]" +
  "(../../web/data/nacl-commands.js) (design-synced verbatim; fix upstream in the numu Design" +
  " System project, re-sync, then regenerate: `node tools/nacl-ref-gen/gen.mjs`)." +
  " `doc-coverage-audit` R5 fails CI when this file drifts from the canon." +
  " Doctrine + grammar: [README.md](README.md).");
lines.push("");

// counts summary
const verbCount = Object.values(verbs).reduce((n, g) => n + g.length, 0);
const objVerbCount = objects.reduce((n, o) => n + (o.verbs || []).length, 0);
lines.push(`Coverage: **${verbCount} generic verbs** across ${Object.keys(verbs).length} groups · ` +
  `**${objects.length} objects** carrying **${objVerbCount} object verbs** · the type vocabularies below. ` +
  "`✅` = built (wired in the sim today) · `○ wanted` = doctrine, not yet wired.");
lines.push("");

lines.push("## Type vocabularies");
lines.push("");
lines.push("| vocabulary | values |");
lines.push("|---|---|");
for (const [k, vals] of Object.entries(types)) lines.push(row([`\`${k}\``, vals.map((v) => `\`${v}\``).join(" ")]));
lines.push("");

lines.push("## Generic verbs — defined once, inherited by every object");
for (const [group, list] of Object.entries(verbs)) {
  lines.push("");
  lines.push(`### ${group} — ${GROUP_NOTES[group] ?? ""}`);
  lines.push("");
  lines.push(...verbTable(list));
}
lines.push("");

lines.push("## Objects — O(1) config rows");
lines.push("");
lines.push("`data` = a table behind a connector (inherits ALL generic verbs) · `artifact` = produced" +
  " from data · `meta` = the conversation / app config.");
lines.push("");
lines.push("| object | label | kind | source | via | key |");
lines.push("|---|---|---|---|---|---|");
for (const o of objects) lines.push(row([`\`${o.id}\``, o.label, o.kind, o.source ?? "—", o.via ?? "—", o.key ?? "—"]));
for (const o of objects.filter((o) => (o.verbs || []).length)) {
  lines.push("");
  lines.push(`### \`${o.id}\` — object verbs`);
  lines.push("");
  lines.push(...verbTable(o.verbs));
}
lines.push("");

const out = lines.join("\n");
if (process.argv.includes("--stdout")) process.stdout.write(out);
else {
  writeFileSync(outPath, out);
  console.log(`wrote ${outPath} (${verbCount} generic + ${objVerbCount} object verbs)`);
}

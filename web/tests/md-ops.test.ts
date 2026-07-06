// md-ops.test.ts — the pure markdown selection algebra (CAS_25dbaded): wrap/toggle, the
// empty-selection stub, line prefixing (quote/ul/ol + toggle-off), and the heading cycle.
// Run: node --test web/tests/   (node strips the types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapSel, prefixLines, cycleHeading, type SelState } from "../src/apps/md-ops.ts";

const st = (value: string, start: number, end: number): SelState => ({ value, start, end });
const selOf = (s: SelState): string => s.value.slice(s.start, s.end);

test("wrapSel wraps a selection and keeps it selected", () => {
  const out = wrapSel(st("make it bold now", 8, 12), "**", "**");
  assert.equal(out.value, "make it **bold** now");
  assert.equal(selOf(out), "bold");
});

test("wrapSel with an empty selection inserts the stub, selected for typing-over", () => {
  const out = wrapSel(st("ab", 1, 1), "*", "*", "text");
  assert.equal(out.value, "a*text*b");
  assert.equal(selOf(out), "text");
});

test("wrapSel toggles OFF when the markers are inside the selection", () => {
  const out = wrapSel(st("a **bold** z", 2, 10), "**", "**");
  assert.equal(out.value, "a bold z");
  assert.equal(selOf(out), "bold");
});

test("wrapSel toggles OFF when the markers surround the selection", () => {
  const out = wrapSel(st("a **bold** z", 4, 8), "**", "**");
  assert.equal(out.value, "a bold z");
  assert.equal(selOf(out), "bold");
});

test("wrapSel builds a link shell around a selection", () => {
  const out = wrapSel(st("see docs here", 4, 8), "[", "](https://x.y)");
  assert.equal(out.value, "see [docs](https://x.y) here");
  assert.equal(selOf(out), "docs");
});

test("prefixLines quotes every non-empty selected line, selecting the block", () => {
  const v = "one\n\ntwo";
  const out = prefixLines(st(v, 0, v.length), "> ");
  assert.equal(out.value, "> one\n\n> two");
  assert.equal(selOf(out), out.value);
});

test("prefixLines toggles OFF when all non-empty lines carry the prefix", () => {
  const v = "> one\n\n> two";
  const out = prefixLines(st(v, 0, v.length), "> ");
  assert.equal(out.value, "one\n\ntwo");
});

test("prefixLines ordered numbers the lines 1..n, skipping blanks", () => {
  const v = "alpha\nbeta\n\ngamma";
  const out = prefixLines(st(v, 0, v.length), "", { ordered: true });
  assert.equal(out.value, "1. alpha\n2. beta\n\n3. gamma");
});

test("prefixLines ordered toggles OFF numbered lines", () => {
  const v = "1. alpha\n2. beta";
  const out = prefixLines(st(v, 0, v.length), "", { ordered: true });
  assert.equal(out.value, "alpha\nbeta");
});

test("prefixLines expands a mid-line caret to the full line", () => {
  const out = prefixLines(st("abc\ndef\nghi", 5, 5), "- ");
  assert.equal(out.value, "abc\n- def\nghi");
});

test("cycleHeading walks none → # → ## → ### → none", () => {
  let s = st("Title", 0, 0);
  s = cycleHeading(s);
  assert.equal(s.value, "# Title");
  s = cycleHeading(s);
  assert.equal(s.value, "## Title");
  s = cycleHeading(s);
  assert.equal(s.value, "### Title");
  s = cycleHeading(s);
  assert.equal(s.value, "Title");
});

test("cycleHeading applies the first line's next level to every selected line", () => {
  const v = "# a\nb";
  const out = cycleHeading(st(v, 0, v.length));
  assert.equal(out.value, "## a\n## b");
});

test("cycleHeading resets an h4+ line to none", () => {
  const out = cycleHeading(st("#### deep", 0, 0));
  assert.equal(out.value, "deep");
});

/* apps/md-ops.ts — PURE markdown selection algebra (CAS_25dbaded, docs/apps/DOCS.md).
   Every toolbar command is a function on {value, start, end} → {value, start, end}: no DOM,
   no amenan imports, so `node --test` covers it directly (web/tests/md-ops.test.ts). The
   md-editor component binds these to buttons/shortcuts and applies the result to its textarea. */

export interface SelState {
  value: string;
  start: number;
  end: number;
}

/** Wrap the selection in `before`/`after` markers — or TOGGLE them off when already present
    (inside the selection, or immediately around it). An empty selection inserts `stub` and
    selects it, so the user types over the placeholder. */
export function wrapSel(s: SelState, before: string, after: string, stub = "text"): SelState {
  const sel = s.value.slice(s.start, s.end);

  /* toggle: markers INSIDE the selection (user selected "**bold**") */
  if (sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after)) {
    const inner = sel.slice(before.length, sel.length - after.length);
    return {
      value: s.value.slice(0, s.start) + inner + s.value.slice(s.end),
      start: s.start,
      end: s.start + inner.length,
    };
  }
  /* toggle: markers AROUND the selection (user selected "bold" inside "**bold**") */
  if (
    s.start >= before.length &&
    s.value.slice(s.start - before.length, s.start) === before &&
    s.value.slice(s.end, s.end + after.length) === after
  ) {
    return {
      value: s.value.slice(0, s.start - before.length) + sel + s.value.slice(s.end + after.length),
      start: s.start - before.length,
      end: s.start - before.length + sel.length,
    };
  }
  /* empty selection: insert the stub and select it */
  if (!sel) {
    return {
      value: s.value.slice(0, s.start) + before + stub + after + s.value.slice(s.end),
      start: s.start + before.length,
      end: s.start + before.length + stub.length,
    };
  }
  /* wrap */
  return {
    value: s.value.slice(0, s.start) + before + sel + after + s.value.slice(s.end),
    start: s.start + before.length,
    end: s.end + before.length,
  };
}

/** The full-line span containing the selection: [lineStart, lineEnd) plus the block text. */
function lineSpan(s: SelState): { from: number; to: number; block: string } {
  const from = s.value.lastIndexOf("\n", Math.max(0, s.start - 1)) + 1;
  const nl = s.value.indexOf("\n", s.end);
  const to = nl === -1 ? s.value.length : nl;
  return { from, to, block: s.value.slice(from, to) };
}

/** Prefix every non-empty selected line (quote `> `, ul `- `); `ordered` numbers them `1. 2. …`.
    Toggles OFF when every non-empty line already carries the prefix. Selects the whole block. */
export function prefixLines(
  s: SelState,
  prefix: string,
  opts: { ordered?: boolean } = {},
): SelState {
  const { from, to, block } = lineSpan(s);
  const lines = block.split("\n");
  const has = (l: string): boolean => (opts.ordered ? /^\d+\.\s/.test(l) : l.startsWith(prefix));
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const allPrefixed = nonEmpty.length > 0 && nonEmpty.every(has);

  let n = 0;
  const next = lines
    .map((l) => {
      if (l.trim() === "") return l;
      if (allPrefixed) return opts.ordered ? l.replace(/^\d+\.\s/, "") : l.slice(prefix.length);
      n += 1;
      return (opts.ordered ? `${n}. ` : prefix) + l;
    })
    .join("\n");

  return { value: s.value.slice(0, from) + next + s.value.slice(to), start: from, end: from + next.length };
}

/** Cycle the heading level of the selected lines: none → # → ## → ### → none (h4–h6 reset to
    none). The FIRST line's current level decides the next; it applies to every selected line. */
export function cycleHeading(s: SelState): SelState {
  const { from, to, block } = lineSpan(s);
  const lines = block.split("\n");
  const level = /^(#{1,6})\s/.exec(lines[0] ?? "")?.[1]?.length ?? 0;
  const nextLevel = level >= 3 ? 0 : level + 1;
  const mark = nextLevel ? "#".repeat(nextLevel) + " " : "";
  const next = lines.map((l) => (l.trim() === "" ? l : mark + l.replace(/^#{1,6}\s/, ""))).join("\n");
  return { value: s.value.slice(0, from) + next + s.value.slice(to), start: from, end: from + next.length };
}

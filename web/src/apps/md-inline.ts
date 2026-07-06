/* md-inline.ts — the inline mini-md the genpdf CV renderer speaks: **bold** · *italic* ·
   `code` · [label](url). ONE tokenizer, two homes: this web renderer (live preview) and the
   Rust `pdf.rs::inline()` (the PDF) — keep them in lockstep so the preview IS the output.
   Plus a toolbar-over-textarea so no one has to type the markers. */

import { el, icon } from "amenan-ui";

interface Span { text: string; bold: boolean; italic: boolean; link: boolean }

/** Tokenize inline mini-md → spans (the port of pdf.rs `inline`). */
export function tokenizeInline(md: string): Span[] {
  const out: Span[] = [];
  let rest = md;
  const push = (text: string, bold = false, italic = false, link = false): void => {
    if (text) out.push({ text, bold, italic, link });
  };
  while (rest) {
    const cands: Array<[number, string]> = [];
    const b = rest.indexOf("**");
    if (b >= 0) cands.push([b, "**"]);
    const i = rest.indexOf("*");
    if (i >= 0) cands.push([i, "*"]);
    const c = rest.indexOf("`");
    if (c >= 0) cands.push([c, "`"]);
    const l = rest.indexOf("[");
    if (l >= 0) cands.push([l, "["]);
    cands.sort((x, y) => x[0] - y[0] || y[1].length - x[1].length);
    const first = cands[0];
    if (!first) {
      push(rest);
      break;
    }
    const [at, tok] = first;
    push(rest.slice(0, at));
    rest = rest.slice(at);
    if (tok === "**") {
      const end = rest.slice(2).indexOf("**");
      if (end >= 0) { push(rest.slice(2, 2 + end), true); rest = rest.slice(2 + end + 2); }
      else { push("**"); rest = rest.slice(2); }
    } else if (tok === "*") {
      const end = rest.slice(1).indexOf("*");
      if (end >= 0) { push(rest.slice(1, 1 + end), false, true); rest = rest.slice(1 + end + 1); }
      else { push("*"); rest = rest.slice(1); }
    } else if (tok === "`") {
      const end = rest.slice(1).indexOf("`");
      if (end >= 0) { push(rest.slice(1, 1 + end), false, true); rest = rest.slice(1 + end + 1); }
      else { push("`"); rest = rest.slice(1); }
    } else {
      const close = rest.indexOf("]");
      const popen = rest.indexOf("](");
      if (close >= 0 && popen === close) {
        const pclose = rest.slice(popen).indexOf(")");
        if (pclose >= 0) { push(rest.slice(1, close), false, false, true); rest = rest.slice(popen + pclose + 1); continue; }
      }
      push("["); rest = rest.slice(1);
    }
  }
  return out;
}

/** Render inline mini-md into an element (styled spans; links are accent-colored, not <a>). */
export function renderInline(md: string): HTMLElement {
  const span = el("span", { class: "nu-mdi" });
  for (const s of tokenizeInline(md)) {
    const cls = [s.bold ? "nu-mdi-b" : "", s.italic ? "nu-mdi-i" : "", s.link ? "nu-mdi-l" : ""].filter(Boolean).join(" ");
    span.appendChild(cls ? el("span", { class: cls }, s.text) : document.createTextNode(s.text));
  }
  return span;
}

/** Wrap the textarea's current selection with before/after markers (or insert a stub), then
    fire input so the model + preview update. Keeps focus + a sensible selection. */
function wrap(ta: HTMLTextAreaElement, before: string, after: string, stub: string): void {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || stub;
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
}

function tbBtn(glyph: string, title: string, on: () => void): HTMLElement {
  return el(
    "button",
    { class: "nu-md-tb-btn", type: "button", title, "aria-label": title, onclick: (ev: Event) => { ev.preventDefault(); on(); } },
    icon(glyph, { size: "0.85rem" }),
  );
}

/** A labeled markdown field: a Bold/Italic/Link toolbar over a textarea. Select text, click a
    button — no markers typed by hand. onChange fires on every edit (drives the live preview). */
export function mdField(label: string, value: string, onChange: (v: string) => void, rows = "3"): HTMLElement {
  const ta = el("textarea", { class: "nu-pf-md nu-md-ta", rows }) as HTMLTextAreaElement;
  ta.value = value;
  ta.addEventListener("input", () => onChange(ta.value));
  const link = (): void => {
    const url = window.prompt("Link URL", "https://");
    if (url) wrap(ta, "[", `](${url})`, "label");
  };
  const toolbar = el(
    "div",
    { class: "nu-md-tb" },
    tbBtn("type-bold", "Bold", () => wrap(ta, "**", "**", "bold")),
    tbBtn("type-italic", "Italic", () => wrap(ta, "*", "*", "italic")),
    tbBtn("link-45deg", "Link", link),
  );
  return el("div", { class: "nu-md-field" }, el("span", { class: "nu-pf-flabel" }, label), toolbar, ta);
}

/* apps/md-editor.ts — the reusable vanilla-TS markdown editor (CAS_25dbaded,
   docs/apps/DOCS.md). react-md-editor served as the feature spec, never the code: a toolbar
   over a plain textarea (every command is pure md-ops algebra), textarea-scoped Ctrl/Cmd+B/I/K,
   and a live preview node re-rendered through amenan's ONE safe renderMarkdown (debounced).
   The HOST decides where the preview lives (the Docs app hands it to the Context panel).
   `mdField` (md-inline.ts) stays separate — it speaks the locked pdf.rs INLINE contract. */

import { el, icon, renderMarkdown } from "amenan-ui";
import { wrapSel, prefixLines, cycleHeading, type SelState } from "./md-ops.ts";

export interface MdEditorCfg {
  value?: string;
  placeholder?: string;
  rows?: number;
  onChange?(v: string): void;
}

export interface MdEditorHandle {
  el: HTMLElement;
  /** the live preview node — mount it wherever fits (context panel, side pane). */
  previewEl: HTMLElement;
  value(): string;
  setValue(v: string, opts?: { silent?: boolean }): void;
  focus(): void;
}

type Op = (s: SelState) => SelState;

export function mountMdEditor(host: Element, cfg: MdEditorCfg = {}): MdEditorHandle {
  const root = el("div", { class: "nu-mde" });
  host.appendChild(root);

  const ta = el("textarea", {
    class: "nu-mde-ta",
    rows: String(cfg.rows ?? 16),
    placeholder: cfg.placeholder ?? "Write markdown…",
  }) as HTMLTextAreaElement;
  ta.value = cfg.value ?? "";

  const previewEl = el("div", { class: "nu-mde-preview nu-scroll" });
  let timer: number | undefined;
  const renderPreview = (): void => {
    previewEl.textContent = "";
    previewEl.appendChild(renderMarkdown(ta.value));
  };
  const schedule = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(renderPreview, 150);
  };

  const changed = (): void => {
    cfg.onChange?.(ta.value);
    schedule();
  };

  /* apply a pure md-ops transform to the textarea's live selection state */
  const apply = (op: Op): void => {
    const next = op({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
    ta.value = next.value;
    ta.setSelectionRange(next.start, next.end);
    ta.focus();
    changed();
  };

  const link: Op = (s) => {
    const url = window.prompt("Link URL (https://…)") ?? "";
    if (!url) return s;
    return wrapSel(s, "[", `](${url})`, "label");
  };

  const commands: Array<{ icon: string; title: string; op: Op }> = [
    { icon: "type-h1", title: "Heading (cycle # · ## · ###)", op: cycleHeading },
    { icon: "type-bold", title: "Bold (Ctrl+B)", op: (s) => wrapSel(s, "**", "**") },
    { icon: "type-italic", title: "Italic (Ctrl+I)", op: (s) => wrapSel(s, "*", "*") },
    { icon: "code", title: "Inline code", op: (s) => wrapSel(s, "`", "`", "code") },
    { icon: "code-square", title: "Code block", op: (s) => wrapSel(s, "```\n", "\n```", "code") },
    { icon: "quote", title: "Quote", op: (s) => prefixLines(s, "> ") },
    { icon: "list-ul", title: "Bullet list", op: (s) => prefixLines(s, "- ") },
    { icon: "list-ol", title: "Numbered list", op: (s) => prefixLines(s, "", { ordered: true }) },
    { icon: "link-45deg", title: "Link (Ctrl+K)", op: link },
  ];

  const tb = el("div", { class: "nu-mde-tb" });
  commands.forEach((c) => {
    const b = el("button", { class: "nu-mde-btn", type: "button", title: c.title, "aria-label": c.title }, icon(c.icon));
    b.addEventListener("click", () => apply(c.op));
    tb.appendChild(b);
  });

  /* textarea-scoped shortcuts ONLY — the console's global keys belong to the composer */
  ta.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      apply((s) => wrapSel(s, "**", "**"));
    } else if (k === "i") {
      e.preventDefault();
      apply((s) => wrapSel(s, "*", "*"));
    } else if (k === "k") {
      e.preventDefault();
      apply(link);
    }
  });
  ta.addEventListener("input", changed);

  root.appendChild(tb);
  root.appendChild(ta);
  renderPreview();

  return {
    el: root,
    previewEl,
    value: () => ta.value,
    setValue(v: string, opts?: { silent?: boolean }): void {
      ta.value = v;
      renderPreview();
      if (!opts?.silent) cfg.onChange?.(v);
    },
    focus: () => ta.focus(),
  };
}

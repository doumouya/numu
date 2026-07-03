/* composer.ts — the nacl prompt: try-chips, a 3-line textarea auto-growing to
   ~10 (Enter sends, Shift+Enter newline), and the staged autocomplete popover
   ABOVE the input (↑↓ cycle, Tab/⏎ accept, Esc dismiss, click works). NO
   channel icons in the composer — a locked design decision (the channel rides
   the ctx of a sent message, not the prompt chrome). Suggestion staging is the pure
   nacl-suggest.ts; this module only adapts the live planes (feed · values
   cache · doctrine catalog) and owns the DOM. */

import { el, icon, chip } from "amenan-ui";
import { naclSuggest, filesFromFeed, type SuggestResult, type SuggestItem } from "./nacl-suggest.ts";

export interface ComposerCfg {
  naclHint: string;
  suggestions: Array<{ text: string }>;
  /** the live feed — the autocomplete's rbac-scoped object plane */
  feed(): NumuBlock[];
  onSend(text: string): void;
}

export interface ComposerHandle {
  el: HTMLElement;
  update(cfg: Partial<Pick<ComposerCfg, "naclHint" | "suggestions">>): void;
  focus(): void;
}

const GROW_MAX = 248;

export function mountComposer(host: Element, cfg: ComposerCfg): ComposerHandle {
  let current = { ...cfg };
  let ac: SuggestResult | null = null;
  let acIdx = 0;

  const root = el("div", { class: "nu-composer" });
  host.appendChild(root);

  /* try-chips */
  const tryRow = el("div", { class: "nu-try-row" });

  /* the popover (positioned above the input row) */
  const pop = el("div", { class: "nu-ac", hidden: "hidden" });

  const ta = el("textarea", {
    class: "nu-prompt-input",
    rows: "3",
    "aria-label": "nacl prompt",
  });
  const sendBtn = el(
    "button",
    { class: "nu-send", title: "Send", "aria-label": "Send", onclick: () => send() },
    icon("send-fill", { size: "1.1rem" }),
  );
  const inputRow = el(
    "div",
    { class: "nu-prompt-row" },
    pop,
    el("span", { class: "nu-prompt-glyph nu-prompt-glyph--lg" }, "›"),
    ta,
    el("button", { class: "nu-attach", title: "Attach", "aria-label": "Attach" }, icon("paperclip", { size: "1.05rem" })),
    sendBtn,
  );

  root.appendChild(tryRow);
  root.appendChild(inputRow);

  function grow(): void {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, GROW_MAX) + "px";
  }

  function send(): void {
    const t = ta.value.trim();
    if (!t) return;
    ta.value = "";
    grow();
    closeAc();
    current.onSend(t);
  }

  function closeAc(): void {
    ac = null;
    acIdx = 0;
    pop.hidden = true;
  }

  function accept(item: SuggestItem): void {
    if (!ac) return;
    const base = ta.value.slice(0, ta.value.length - ac.tok.length);
    ta.value = base + item.insert;
    closeAc();
    ta.focus();
    grow();
  }

  function renderAc(): void {
    if (!ac || !ac.items.length) {
      pop.hidden = true;
      return;
    }
    pop.textContent = "";
    ac.items.forEach((it, i) => {
      pop.appendChild(
        el(
          "button",
          {
            class: `nu-ac-item${i === acIdx ? " is-active" : ""}`,
            onmousedown: (e: Event) => {
              e.preventDefault();
              accept(it);
            },
          },
          el("span", { class: "nu-ac-label" }, it.label),
          el("span", { class: "nu-spring" }),
          el("span", { class: "nu-ac-hint" }, it.hint),
        ),
      );
    });
    pop.appendChild(
      el(
        "div",
        { class: "nu-ac-foot" },
        el("span", {}, "⇥ / ⏎ accept · ↑↓ · esc"),
        el("span", { class: "nu-spring" }),
        el("span", { class: "nu-ac-rbac" }, "rbac · scoped to your access"),
      ),
    );
    pop.hidden = false;
  }

  ta.addEventListener("input", () => {
    grow();
    ac = naclSuggest(
      ta.value,
      filesFromFeed(current.feed()),
      window.__NUMU_VALUES ?? {},
      window.NACL_COMMANDS?.objects ?? [],
    );
    acIdx = 0;
    renderAc();
  });

  ta.addEventListener("keydown", (e) => {
    if (ac && ac.items.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        acIdx = (acIdx + 1) % ac.items.length;
        renderAc();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        acIdx = (acIdx - 1 + ac.items.length) % ac.items.length;
        renderAc();
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const item = ac.items[acIdx];
        if (item) accept(item);
        return;
      }
      if (e.key === "Escape") {
        closeAc();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function render(): void {
    ta.placeholder = `nacl · ${current.naclHint}`;
    tryRow.textContent = "";
    tryRow.appendChild(el("span", { class: "nu-try-label" }, "try"));
    current.suggestions.forEach((s) => {
      const c = chip({
        label: s.text,
        onClick: () => {
          ta.value = s.text;
          ta.dispatchEvent(new Event("input"));
          ta.focus();
        },
      });
      c.classList.add("nu-try-chip");
      tryRow.appendChild(c);
    });
  }

  render();
  grow();
  return {
    el: root,
    update(partial) {
      current = { ...current, ...partial };
      render();
    },
    focus() {
      ta.focus();
    },
  };
}

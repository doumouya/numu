/* composer.ts — the always-ready nacl terminal, docked under EVERY page
   (workspace · store): numu is a command line first, screens second. One-line
   prompt growing to ~10 (Enter sends, Shift+Enter newline), the staged
   autocomplete popover ABOVE the input, and the action bar: a ➕ more-menu
   (attach & send · insert · reach out · schedule & assist), mic, emoji, the
   Claude assistant, input settings, and send. Suggestion staging is the pure
   nacl-suggest.ts; this module only adapts the live planes and owns the DOM. */

import { el, icon, chip } from "amenan-ui";
import { naclSuggest, filesFromFeed, type SuggestResult, type SuggestItem } from "./nacl-suggest.ts";

export interface ComposerCfg {
  naclHint: string;
  suggestions: Array<{ text: string }>;
  /** the current page id — a non-workspace page prefixes the try label */
  page?: string;
  /** the live feed — the autocomplete's rbac-scoped object plane */
  feed(): NumuBlock[];
  onSend(text: string): void;
  onChannel(id: string): void;
  /** stub actions surface as toasts (title, detail, tone) */
  onAction(title: string, detail: string, tone?: string): void;
}

export interface ComposerHandle {
  el: HTMLElement;
  update(cfg: Partial<Pick<ComposerCfg, "naclHint" | "suggestions" | "page">>): void;
  focus(): void;
}

const GROW_MAX = 248;

interface MenuItem {
  icon: string;
  img?: string;
  label: string;
  hint?: string;
  accent?: boolean;
  on(): void;
}

export function mountComposer(host: Element, cfg: ComposerCfg): ComposerHandle {
  let current = { ...cfg };
  let ac: SuggestResult | null = null;
  let acIdx = 0;
  let moreOpen = false;

  const root = el("div", { class: "nu-composer" });
  host.appendChild(root);

  const tryRow = el("div", { class: "nu-try-row" });
  const pop = el("div", { class: "nu-ac", hidden: "hidden" });
  const moreMenu = el("div", { class: "nu-more", hidden: "hidden" });

  const ta = el("textarea", { class: "nu-prompt-input", rows: "1", "aria-label": "nacl prompt" });
  const inputLine = el("div", { class: "nu-prompt-line" }, el("span", { class: "nu-prompt-glyph nu-prompt-glyph--lg" }, "›"), ta);

  const act = (label: string, detail: string, tone?: string): void => {
    closeMore();
    current.onAction(label, detail, tone);
  };

  const MENU: Array<{ head: string; items: MenuItem[] }> = [
    {
      head: "Attach & send",
      items: [
        { icon: "paperclip", label: "File", on: () => act("Attach", "Pick a file · CSV runs the profiler") },
        { icon: "camera-fill", label: "Photo", on: () => act("Camera", "Capture a photo") },
        { icon: "mic-fill", label: "Audio", on: () => act("Audio", "Record a voice note") },
      ],
    },
    {
      head: "Insert",
      items: [
        { icon: "emoji-smile", label: "Emoji", on: () => act("Emoji", "Pick an emoji") },
        { icon: "filetype-gif", label: "GIF", on: () => act("GIF", "Search GIFs") },
        { icon: "stickies-fill", label: "Sticker", on: () => act("Sticker", "Pick a sticker") },
      ],
    },
    {
      head: "Reach out",
      items: [
        { icon: "envelope-fill", label: "Email", hint: "channel", on: () => { closeMore(); current.onChannel("email"); } },
        { icon: "chat-dots-fill", label: "SMS", hint: "channel", on: () => { closeMore(); current.onChannel("sms"); } },
        { icon: "telephone-fill", label: "Call", hint: "channel", on: () => { closeMore(); current.onChannel("call"); } },
        { icon: "camera-video-fill", img: "assets/logos/gmeet.png", label: "Video call", on: () => act("Video call", "Start a Google Meet call") },
      ],
    },
    {
      head: "Schedule & assist",
      items: [
        { icon: "calendar-event", img: "assets/logos/gcal.png", label: "Calendar", on: () => act("Calendar", "Open Google Calendar to schedule") },
        { icon: "stars", img: "assets/claude-mark.png", label: "Claude assistant", accent: true, on: () => act("Claude", "Draft, summarize, or plan with Claude") },
      ],
    },
  ];

  function renderMore(): void {
    moreMenu.textContent = "";
    MENU.forEach((sec) => {
      const grid = el("div", { class: "nu-more-grid" });
      sec.items.forEach((it) => {
        grid.appendChild(
          el(
            "button",
            {
              class: `nu-more-item${it.accent ? " is-accent" : ""}`,
              title: it.hint ? `${it.label} · ${it.hint}` : it.label,
              "aria-label": it.label,
              onclick: it.on,
            },
            it.img ? el("img", { src: it.img, alt: "", class: "nu-more-img" }) : icon(it.icon, { size: "1.1rem" }),
          ),
        );
      });
      moreMenu.appendChild(el("div", { class: "nu-more-sec" }, el("div", { class: "nu-more-head" }, sec.head), grid));
    });
  }

  function closeMore(): void {
    moreOpen = false;
    moreMenu.hidden = true;
  }

  const moreBtn = el(
    "button",
    {
      class: "nu-act",
      title: "More options",
      "aria-label": "More options",
      onclick: (e: Event) => {
        e.stopPropagation();
        moreOpen = !moreOpen;
        moreMenu.hidden = !moreOpen;
        moreBtn.classList.toggle("is-active", moreOpen);
      },
    },
    icon("plus-lg", { size: "1.15rem" }),
  );
  document.addEventListener("mousedown", (e) => {
    if (moreOpen && !moreMenu.contains(e.target as Node) && e.target !== moreBtn) closeMore();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && moreOpen) closeMore();
  });

  const actBtn = (glyph: string, title: string, on: () => void, img?: string): HTMLButtonElement =>
    el(
      "button",
      { class: "nu-act", title, "aria-label": title, onclick: on },
      img ? el("img", { src: img, alt: title, class: "nu-more-img" }) : icon(glyph, { size: "1.05rem" }),
    );

  const actionBar = el(
    "div",
    { class: "nu-action-bar" },
    el("span", { class: "nu-more-anchor" }, moreMenu, moreBtn),
    actBtn("mic-fill", "Record audio", () => act("Audio", "Record a voice note")),
    actBtn("emoji-smile", "Emoji", () => act("Emoji", "Pick an emoji")),
    actBtn("", "Claude assistant", () => act("Claude", "Draft, summarize, or plan with Claude"), "assets/claude-mark.png"),
    actBtn("gear", "Input settings", () => act("Input settings", "Configure composer options — coming soon", "warn")),
    el("span", { class: "nu-spring" }),
    el("span", { class: "nu-kbd-hint" }, "⏎ send · ⇧⏎ line"),
    el("button", { class: "nu-send", title: "Send", "aria-label": "Send", onclick: () => send() }, icon("send-fill", { size: "1rem" })),
  );

  const inputRow = el("div", { class: "nu-prompt-row nu-prompt-row--col" }, pop, inputLine, actionBar);
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
    const label = current.page && current.page !== "workspace" ? `${current.page} · try` : "try";
    tryRow.appendChild(el("span", { class: "nu-try-label" }, label));
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

  renderMore();
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

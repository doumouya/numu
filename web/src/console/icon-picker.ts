/* icon-picker.ts — a compact, in-app icon picker (select, not copy): a search
   over the full Bootstrap Icons name list (web/data/bi-icon-names.js, synced)
   with a curated "common" grid when the query is empty. Calls onPick(name) —
   wired into real flows (channel + project creation). */

import { el, icon } from "amenan-ui";

const COMMON = [
  "hash", "folder", "folder2-open", "collection", "kanban", "list-task", "inbox",
  "star", "star-fill", "bookmark", "flag", "pin-angle", "tag", "tags", "heart",
  "music-note-beamed", "disc", "vinyl", "mic", "soundwave", "headphones", "broadcast",
  "camera-video", "film", "image", "images", "palette", "brush",
  "people", "person", "person-badge", "chat", "chat-dots", "megaphone", "send",
  "calendar-event", "clock-history", "briefcase", "building", "bank", "rocket-takeoff",
  "lightning-charge", "activity", "graph-up", "bar-chart", "pie-chart", "diagram-3",
  "file-earmark", "file-earmark-music", "clipboard-data", "archive", "boxes", "box-seam",
  "truck", "globe", "geo-alt", "cash-stack", "receipt", "credit-card", "gear",
];

export interface IconPickerCfg {
  value?: string;
  onPick(name: string): void;
}

export function mountIconPicker(host: Element, cfg: IconPickerCfg): { el: HTMLElement; destroy(): void } {
  const all = window.BI_ICON_NAMES ?? [];
  const root = el("div", { class: "nu-ipick", onclick: (e: Event) => e.stopPropagation() });
  host.appendChild(root);

  const input = el("input", {
    class: "nu-ipick-search",
    placeholder: `Search ${all.length || ""} icons…`,
    "aria-label": "Search icons",
  });
  const meta = el("div", { class: "nu-ipick-meta" }, "Common");
  const grid = el("div", { class: "nu-ipick-grid" });

  root.appendChild(el("div", { class: "nu-ipick-searchwrap" }, icon("search", { size: "0.72rem" }), input));
  root.appendChild(meta);
  root.appendChild(grid);

  function render(): void {
    const q = input.value.trim().toLowerCase();
    const list = q ? all.filter((n) => n.includes(q)).slice(0, 240) : COMMON;
    meta.textContent = q ? `${list.length} matched` : "Common";
    grid.textContent = "";
    if (!list.length) {
      grid.appendChild(el("div", { class: "nu-ipick-empty" }, `No icons match “${input.value}”.`));
      return;
    }
    list.forEach((n) => {
      grid.appendChild(
        el(
          "button",
          {
            class: `nu-ipick-cell${n === cfg.value ? " is-active" : ""}`,
            type: "button",
            title: n,
            onclick: () => cfg.onPick(n),
          },
          icon(n),
        ),
      );
    });
  }

  input.addEventListener("input", render);
  render();
  input.focus();
  return { el: root, destroy: () => root.remove() };
}

/* projects-panel.ts — the left "Objects panel": the workspace's organizational
   tree. PRIMARY: channels (topic groups) → projects (each a live conversation).
   Then, as convenience: quick-access objects pinned to the rail.
   Projects are ENGINE objects (create/rename/move/pin/delete flow through the
   seam); channels are local "this-device" user data. Create flows carry an
   icon (the picker) + a color; channels drag-reorder, collapse (count badge),
   and hide/restore. Local UI state re-renders the whole panel (cheap). */

import { el, icon } from "amenan-ui";
import { mountIconPicker } from "./icon-picker.ts";

const PROJ_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
];

export function initialsOf(name: string): string {
  return (
    String(name || "?")
      .split(/[\s—–-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export interface NewProjectOpts {
  name: string;
  channel: string | null;
  icon: string;
  color: string;
}

export interface ProjectsPanelCfg {
  channels: ConsoleChannel[];
  projects: ConsoleProject[];
  objects: ConsoleObject[];
  objectsLabel?: string;
  activeProjectId: string | null;
  activeObjectId: string | null;
  onSelectProject(id: string): void;
  onOpenObject(o: ConsoleObject): void;
  onNewProject(opts: NewProjectOpts): void;
  onRenameProject(id: string, name: string): void;
  onMoveProject(id: string, channel: string): void;
  onDeleteProject(id: string): void;
  onTogglePin(id: string): void;
  onAddChannel(name: string, icon: string): void;
  onRenameChannel(id: string, name: string): void;
  onDeleteChannel(id: string): void;
  onReorderChannel(fromId: string, toId: string): void;
  onToggleCollapse(id: string): void;
  onHideChannel(id: string): void;
  onRestoreChannel(id: string): void;
}

export interface ProjectsPanelHandle {
  el: HTMLElement;
  update(cfg: ProjectsPanelCfg): void;
}

interface UiState {
  menu: { kind: "project" | "channel"; id: string } | null;
  renaming: { kind: "project" | "channel"; id: string } | null;
  addingChannel: boolean;
  chanIcon: string;
  chanIconOpen: boolean;
  addingProj: string | null;
  projIcon: string;
  projColor: string;
  projIconOpen: boolean;
  dragId: string | null;
  chanDragId: string | null;
}

export function mountProjectsPanel(host: Element, cfg: ProjectsPanelCfg): ProjectsPanelHandle {
  let c = cfg;
  const ui: UiState = {
    menu: null,
    renaming: null,
    addingChannel: false,
    chanIcon: "hash",
    chanIconOpen: false,
    addingProj: null,
    projIcon: "",
    projColor: PROJ_COLORS[0] ?? "var(--chart-1)",
    projIconOpen: false,
    dragId: null,
    chanDragId: null,
  };

  const root = el("div", { class: "nu-projects", onclick: () => { if (ui.menu) { ui.menu = null; render(); } } });
  host.appendChild(root);
  const scroll = el("div", { class: "nu-projects-scroll" });
  root.appendChild(scroll);

  const stop = (e: Event): void => e.stopPropagation();

  function dot(glyph: string, title: string, on: (e: Event) => void, active = false): HTMLElement {
    return el(
      "button",
      { class: `nu-pp-dot${active ? " is-on" : ""}`, title, "aria-label": title, onclick: (e: Event) => { e.stopPropagation(); on(e); } },
      icon(glyph, { size: "0.7rem" }),
    );
  }

  function renameInput(kind: "project" | "channel", id: string, initial: string): HTMLInputElement {
    const input = el("input", { class: kind === "channel" ? "nu-pp-input nu-pp-input--chan" : "nu-pp-input", value: initial, onclick: stop });
    const commit = (): void => {
      const v = input.value.trim();
      ui.renaming = null;
      if (v && v !== initial) (kind === "project" ? c.onRenameProject : c.onRenameChannel)(id, v);
      else render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { ui.renaming = null; render(); }
    });
    input.addEventListener("blur", commit);
    setTimeout(() => input.focus(), 0);
    return input;
  }

  function menuBox(items: Array<{ glyph: string; label: string; danger?: boolean; on(): void } | { heading: string }>, indent: string): HTMLElement {
    const box = el("div", { class: "nu-pp-menu", style: `margin-left:${indent}`, onclick: stop });
    items.forEach((it) => {
      if ("heading" in it) {
        box.appendChild(el("div", { class: "nu-pp-menu-label" }, it.heading));
      } else {
        box.appendChild(
          el(
            "button",
            { class: `nu-pp-menu-item${it.danger ? " is-danger" : ""}`, onclick: () => { ui.menu = null; it.on(); } },
            icon(it.glyph, { size: "0.72rem" }),
            it.label,
          ),
        );
      }
    });
    return box;
  }

  function projectsIn(chId: string, isFirst: boolean): ConsoleProject[] {
    const chanIds = c.channels.map((x) => x.id);
    const own = c.projects.filter((p) => p.channel === chId || (isFirst && !chanIds.includes(p.channel)));
    return own.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }

  function addProjectRow(chId: string): HTMLElement {
    const nameInput = el("input", { class: "nu-pp-input nu-pp-input--form", placeholder: "Project name…", onclick: stop });
    const iconBtn = el(
      "button",
      {
        class: `nu-pp-projicon${ui.projIconOpen ? " is-on" : ""}`,
        type: "button",
        title: "Pick an icon",
        style: `background:${ui.projColor}`,
        onmousedown: (e: Event) => e.preventDefault(),
        onclick: (e: Event) => { e.stopPropagation(); ui.projIconOpen = !ui.projIconOpen; render(); },
      },
      ui.projIcon ? icon(ui.projIcon, { size: "0.8rem" }) : el("span", { class: "nu-pp-projini" }, initialsOf(nameInput.value)),
    );
    const commit = (): void => {
      c.onNewProject({ name: nameInput.value.trim(), channel: ui.addingProj, icon: ui.projIcon, color: ui.projColor });
      ui.addingProj = null;
      ui.projIcon = "";
      ui.projIconOpen = false;
      render();
    };
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { ui.addingProj = null; ui.projIconOpen = false; render(); }
    });
    const swatches = el("div", { class: "nu-pp-swatches" });
    PROJ_COLORS.forEach((col) => {
      swatches.appendChild(
        el("button", {
          class: `nu-pp-swatch${ui.projColor === col ? " is-on" : ""}`,
          type: "button",
          title: "Colour",
          style: `background:${col}`,
          onclick: (e: Event) => { e.stopPropagation(); ui.projColor = col; render(); },
        }),
      );
    });
    const wrap = el(
      "div",
      { class: "nu-pp-addform", onclick: stop },
      el(
        "div",
        { class: "nu-pp-addline" },
        iconBtn,
        nameInput,
        el("button", { class: "nu-pp-chaniconbtn", type: "button", title: "Create project", onclick: (e: Event) => { e.stopPropagation(); commit(); } }, icon("check-lg", { size: "0.85rem" })),
      ),
      swatches,
    );
    if (ui.projIconOpen) {
      const slot = el("div", { class: "nu-pp-pickslot" });
      mountIconPicker(slot, { value: ui.projIcon, onPick: (n) => { ui.projIcon = n; ui.projIconOpen = false; render(); } });
      wrap.appendChild(slot);
    }
    setTimeout(() => nameInput.focus(), 0);
    if (chId === ui.addingProj) return wrap;
    return wrap;
  }

  function channelBlock(ch: ConsoleChannel, ci: number): HTMLElement {
    const inCh = projectsIn(ch.id, ci === 0);
    const block = el("div", { class: "nu-pp-chanblock" });
    block.addEventListener("dragover", (e) => {
      if (ui.dragId || (ui.chanDragId && ui.chanDragId !== ch.id)) {
        e.preventDefault();
        block.classList.add(ui.dragId ? "is-drop" : "is-chandrop");
      }
    });
    block.addEventListener("dragleave", () => block.classList.remove("is-drop", "is-chandrop"));
    block.addEventListener("drop", (e) => {
      e.preventDefault();
      if (ui.dragId) c.onMoveProject(ui.dragId, ch.id);
      else if (ui.chanDragId) c.onReorderChannel(ui.chanDragId, ch.id);
      ui.dragId = null;
      ui.chanDragId = null;
    });

    const grip = el(
      "span",
      { class: "nu-pp-changrip", title: "Drag to reorder", draggable: "true" },
      icon(ch.icon || "hash", { size: "0.9rem" }),
    );
    grip.addEventListener("dragstart", (e) => {
      ui.chanDragId = ch.id;
      try { (e as DragEvent).dataTransfer!.effectAllowed = "move"; } catch { /* jsdom */ }
    });
    grip.addEventListener("dragend", () => { ui.chanDragId = null; });

    const head = el(
      "div",
      { class: "nu-pp-chanhead" },
      el(
        "button",
        { class: "nu-pp-chev", title: ch.collapsed ? "Expand" : "Collapse", onclick: (e: Event) => { e.stopPropagation(); c.onToggleCollapse(ch.id); } },
        icon(ch.collapsed ? "chevron-right" : "chevron-down", { size: "0.7rem" }),
      ),
      grip,
      ui.renaming?.kind === "channel" && ui.renaming.id === ch.id
        ? renameInput("channel", ch.id, ch.name)
        : el("span", { class: "nu-pp-channame", onclick: (e: Event) => { e.stopPropagation(); c.onToggleCollapse(ch.id); } }, ch.name),
      ch.collapsed && inCh.length ? el("span", { class: "nu-pp-count" }, String(inCh.length)) : null,
      dot("plus-lg", "New project here", () => {
        if (ch.collapsed) c.onToggleCollapse(ch.id);
        ui.menu = null;
        ui.addingChannel = false;
        ui.addingProj = ch.id;
        ui.projIcon = "";
        ui.projColor = PROJ_COLORS[0] ?? "var(--chart-1)";
        ui.projIconOpen = false;
        render();
      }),
      dot("three-dots", "Channel options", () => {
        ui.menu = ui.menu?.kind === "channel" && ui.menu.id === ch.id ? null : { kind: "channel", id: ch.id };
        render();
      }),
    );
    block.appendChild(head);

    if (ui.menu?.kind === "channel" && ui.menu.id === ch.id) {
      const items: Parameters<typeof menuBox>[0] = [
        { glyph: "pencil", label: "Rename", on: () => { ui.renaming = { kind: "channel", id: ch.id }; render(); } },
        { glyph: "eye-slash", label: "Hide", on: () => c.onHideChannel(ch.id) },
      ];
      if (!ch.system) items.push({ glyph: "trash3", label: "Delete", danger: true, on: () => c.onDeleteChannel(ch.id) });
      block.appendChild(menuBox(items, "1.4rem"));
    }

    if (!ch.collapsed && ui.addingProj === ch.id) block.appendChild(addProjectRow(ch.id));

    if (!ch.collapsed) {
      inCh.forEach((p) => {
        const row = el(
          "div",
          {
            class: `nu-projects-row${p.id === c.activeProjectId ? " is-active" : ""}`,
            draggable: "true",
            onclick: (e: Event) => { e.stopPropagation(); ui.menu = null; c.onSelectProject(p.id); },
          },
          el(
            "span",
            { class: "nu-pp-mark", style: `background:${p.color}` },
            p.icon ? icon(p.icon, { size: "0.85rem" }) : p.mark || initialsOf(p.name),
          ),
          ui.renaming?.kind === "project" && ui.renaming.id === p.id
            ? renameInput("project", p.id, p.name)
            : el("span", { class: "nu-projects-name" }, p.name),
          dot("three-dots", "More", () => {
            ui.menu = ui.menu?.kind === "project" && ui.menu.id === p.id ? null : { kind: "project", id: p.id };
            render();
          }),
          dot(p.pinned ? "pin-angle-fill" : "pin-angle", p.pinned ? "Unpin" : "Pin", () => c.onTogglePin(p.id), !!p.pinned),
        );
        row.addEventListener("dragstart", (e) => {
          ui.dragId = p.id;
          try { (e as DragEvent).dataTransfer!.effectAllowed = "move"; } catch { /* jsdom */ }
        });
        row.addEventListener("dragend", () => { ui.dragId = null; });
        block.appendChild(row);

        if (ui.menu?.kind === "project" && ui.menu.id === p.id) {
          const items: Parameters<typeof menuBox>[0] = [
            { glyph: "pencil", label: "Rename", on: () => { ui.renaming = { kind: "project", id: p.id }; render(); } },
            { heading: "Move to" },
          ];
          c.channels.filter((x) => x.id !== p.channel && !x.hidden).forEach((x) => {
            items.push({ glyph: "hash", label: x.name, on: () => c.onMoveProject(p.id, x.id) });
          });
          items.push({ glyph: "trash3", label: "Delete", danger: true, on: () => c.onDeleteProject(p.id) });
          block.appendChild(menuBox(items, "2.1rem"));
        }
      });
    }
    return block;
  }

  function addChannelRow(): HTMLElement {
    if (!ui.addingChannel) {
      return el(
        "button",
        { class: "nu-pp-addchan", onclick: (e: Event) => { e.stopPropagation(); ui.addingChannel = true; ui.chanIcon = "hash"; ui.chanIconOpen = false; ui.menu = null; render(); } },
        icon("plus-lg", { size: "0.72rem" }),
        "New channel",
      );
    }
    const nameInput = el("input", { class: "nu-pp-input nu-pp-input--form", placeholder: "Channel name…", onclick: stop });
    const commit = (): void => {
      const v = nameInput.value.trim();
      if (v) c.onAddChannel(v, ui.chanIcon);
      ui.addingChannel = false;
      ui.chanIconOpen = false;
      render();
    };
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { ui.addingChannel = false; ui.chanIconOpen = false; render(); }
    });
    const wrap = el(
      "div",
      { class: "nu-pp-addform", onclick: stop },
      el(
        "div",
        { class: "nu-pp-addline" },
        el(
          "button",
          { class: `nu-pp-chaniconbtn${ui.chanIconOpen ? " is-on" : ""}`, type: "button", title: "Pick an icon", onmousedown: (e: Event) => e.preventDefault(), onclick: (e: Event) => { e.stopPropagation(); ui.chanIconOpen = !ui.chanIconOpen; render(); } },
          icon(ui.chanIcon || "hash", { size: "0.8rem" }),
        ),
        nameInput,
        el("button", { class: "nu-pp-chaniconbtn", type: "button", title: "Create channel", onclick: (e: Event) => { e.stopPropagation(); commit(); } }, icon("check-lg", { size: "0.85rem" })),
      ),
    );
    if (ui.chanIconOpen) {
      const slot = el("div", { class: "nu-pp-pickslot" });
      mountIconPicker(slot, { value: ui.chanIcon, onPick: (n) => { ui.chanIcon = n; ui.chanIconOpen = false; render(); } });
      wrap.appendChild(slot);
    }
    setTimeout(() => nameInput.focus(), 0);
    return wrap;
  }

  function render(): void {
    scroll.textContent = "";
    const visible = c.channels.filter((x) => !x.hidden);
    const hidden = c.channels.filter((x) => x.hidden);

    visible.forEach((ch, ci) => scroll.appendChild(channelBlock(ch, ci)));
    scroll.appendChild(addChannelRow());

    if (hidden.length) {
      const sec = el(
        "div",
        { class: "nu-pp-hidden" },
        el("div", { class: "nu-pp-chanhead nu-pp-chanhead--flat" }, icon("eye-slash", { size: "0.85rem" }), el("span", { class: "nu-pp-channame" }, `Hidden · ${hidden.length}`)),
      );
      hidden.forEach((ch) => {
        sec.appendChild(
          el(
            "div",
            { class: "nu-pp-restore" },
            icon(ch.icon || "hash", { size: "0.85rem" }),
            el("span", { class: "nu-projects-name" }, ch.name),
            dot("arrow-counterclockwise", "Restore channel", () => c.onRestoreChannel(ch.id)),
          ),
        );
      });
      scroll.appendChild(sec);
    }

    if (c.objects.length) {
      const sec = el(
        "div",
        { class: "nu-pp-objects" },
        el("div", { class: "nu-pp-chanhead nu-pp-chanhead--flat" }, icon("collection", { size: "0.68rem" }), el("span", { class: "nu-pp-channame" }, c.objectsLabel ?? "Objects")),
      );
      c.objects.forEach((o) => {
        sec.appendChild(
          el(
            "div",
            { class: `nu-projects-row${o.id === c.activeObjectId ? " is-active" : ""}`, onclick: (e: Event) => { e.stopPropagation(); c.onOpenObject(o); } },
            el("span", { class: "nu-projects-objicon", style: `color:${o.accent}` }, icon(o.icon, { size: "0.9rem" })),
            el("span", { class: "nu-projects-name" }, o.name),
          ),
        );
      });
      scroll.appendChild(sec);
    }
  }

  render();
  return {
    el: root,
    update(next) {
      c = next;
      render();
    },
  };
}

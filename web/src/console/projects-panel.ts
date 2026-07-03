/* projects-panel.ts — the left "Objects" panel: an overview entry, the object
   list (opens the Context panel), then channels each holding project rows as
   colored monogram squares. Active state = accent-soft fill + a thin inset
   accent bar (the numu selection cue — never a colored-left-border card). */

import { el, icon, button } from "amenan-ui";

export interface ProjectsPanelCfg {
  overview: ConsoleTenantData["overview"];
  channels: ConsoleChannel[];
  projects: ConsoleProject[];
  objects: ConsoleObject[];
  activeProjectId: string | null;
  activeObjectId: string | null;
  overviewActive: boolean;
  onSelectProject(id: string): void;
  onSelectOverview(): void;
  onOpenObject(o: ConsoleObject): void;
  onNew(): void;
}

export interface ProjectsPanelHandle {
  el: HTMLElement;
  update(cfg: ProjectsPanelCfg): void;
}

export function mountProjectsPanel(host: Element, cfg: ProjectsPanelCfg): ProjectsPanelHandle {
  const root = el("div", { class: "nu-projects" });
  host.appendChild(root);

  function render(c: ProjectsPanelCfg): void {
    root.textContent = "";
    root.appendChild(
      el(
        "div",
        { class: "nu-projects-head" },
        el("span", { class: "nu-projects-title" }, "Objects"),
        el("span", { class: "nu-spring" }),
        button({ icon: "bi-plus-lg", variant: "ghost", size: "sm", title: "New project", onClick: c.onNew }),
      ),
    );

    const scroll = el("div", { class: "nu-projects-scroll" });
    root.appendChild(scroll);

    scroll.appendChild(
      el(
        "div",
        {
          class: `nu-projects-row nu-projects-overview${c.overviewActive ? " is-active" : ""}`,
          onclick: c.onSelectOverview,
        },
        icon(c.overview.icon, { size: "0.95em" }),
        el("span", {}, c.overview.name),
      ),
    );

    scroll.appendChild(
      el("div", { class: "nu-projects-chan" }, icon("collection", { size: "0.68rem" }), el("span", {}, "Objects")),
    );
    c.objects.forEach((o) => {
      scroll.appendChild(
        el(
          "div",
          {
            class: `nu-projects-row${o.id === c.activeObjectId ? " is-active" : ""}`,
            onclick: () => c.onOpenObject(o),
          },
          el("span", { class: "nu-projects-objicon", style: `color:${o.accent}` }, icon(o.icon, { size: "0.9rem" })),
          el("span", { class: "nu-projects-name" }, o.name),
        ),
      );
    });

    const groups = c.channels
      .map((ch) => ({
        ...ch,
        projects:
          ch.id === "pinned"
            ? c.projects.filter((p) => p.pinned)
            : c.projects.filter((p) => p.channel === ch.id),
      }))
      .filter((g) => g.projects.length);

    groups.forEach((g) => {
      scroll.appendChild(
        el("div", { class: "nu-projects-chan" }, icon(g.icon, { size: "0.68rem" }), el("span", {}, g.name)),
      );
      g.projects.forEach((p) => {
        scroll.appendChild(
          el(
            "div",
            {
              class: `nu-projects-row${p.id === c.activeProjectId ? " is-active" : ""}`,
              onclick: () => c.onSelectProject(p.id),
            },
            el("span", { class: "nu-projects-mark", style: `background:${p.color}` }, p.mark),
            el("span", { class: "nu-projects-name" }, p.name),
          ),
        );
      });
    });
  }

  render(cfg);
  return { el: root, update: render };
}

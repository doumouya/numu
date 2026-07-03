/* connectors.ts — the connectors page (rail plug button): a brand-colored
   catalog grouped by provider; connected sources show a check, the rest a
   Connect action; on-device connectors carry the on-device badge (data never
   leaves the page). Opening a tile shows its config in the Context panel. */

import { el, icon, badge, button } from "amenan-ui";

export interface ConnectorsCfg {
  groups: Array<{ group: string; items: ConsoleConnector[] }>;
  activeId: string | null;
  onOpen(c: ConsoleConnector): void;
}

export interface ConnectorsHandle {
  el: HTMLElement;
  update(cfg: ConnectorsCfg): void;
}

export function mountConnectors(host: Element, cfg: ConnectorsCfg): ConnectorsHandle {
  const root = el("div", { class: "nu-connectors" });
  host.appendChild(root);
  let cfgRef = cfg;

  function render(c: ConnectorsCfg): void {
    root.textContent = "";
    root.appendChild(el("h2", { class: "nu-connectors-h" }, "Connectors"));
    root.appendChild(
      el(
        "p",
        { class: "nu-connectors-sub" },
        "Bring the outside in — every source lands as records. On-device connectors keep the data on the page; nothing is uploaded.",
      ),
    );
    c.groups.forEach((g) => {
      root.appendChild(el("div", { class: "nu-connectors-group" }, g.group));
      const grid = el("div", { class: "nu-connectors-grid" });
      root.appendChild(grid);
      g.items.forEach((it) => {
        grid.appendChild(
          el(
            "div",
            {
              class: `nu-connectors-tile${it.id === c.activeId ? " is-active" : ""}`,
              onclick: () => c.onOpen(it),
            },
            el("span", { class: "nu-connectors-badge", style: `background:${it.color}` }, icon(it.icon)),
            el(
              "span",
              { class: "nu-connectors-meta" },
              el("span", { class: "nu-connectors-name" }, it.name),
              el(
                "span",
                { class: "nu-connectors-tags" },
                badge({ label: it.kind }),
                it.local ? badge({ label: "on-device", tone: "accent" }) : null,
              ),
            ),
            it.connected
              ? el("span", { class: "nu-connectors-ok" }, icon("check-circle-fill"), " connected")
              : button({
                  label: "Connect",
                  size: "sm",
                  onClick: (e) => {
                    e.stopPropagation();
                    cfgRef.onOpen(it);
                  },
                }),
          ),
        );
      });
    });
  }

  render(cfg);
  return {
    el: root,
    update(next) {
      cfgRef = next;
      render(next);
    },
  };
}

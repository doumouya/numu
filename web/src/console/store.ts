/* store.ts — the numu Store. Three shelves reached from the topbar: Apps
   (embeddable tools that open in the Context panel), Agents (Claude-powered
   skills — procedures & playbooks), and Connectors (external sources, grouped
   by provider, real brand logos). Search filters the active shelf; installing/
   enabling flips local state; clicking a card opens its detail in the panel. */

import { el, icon, badge, button, input, mountTabs, mountEmptyState } from "amenan-ui";

export type StoreOpen =
  | (ConsoleConnector & { type: "connector" })
  | (ConsoleStoreApp & { type: "storeItem"; storeKind: "App" | "Agent"; on: boolean; onLabel: string });

export interface StoreCfg {
  groups: Array<{ group: string; items: ConsoleConnector[] }>;
  apps: ConsoleStoreApp[];
  agents: ConsoleStoreApp[];
  activeId: string | null;
  onOpen(o: StoreOpen): void;
  onToast(title: string, msg: string, tone?: string): void;
}

export interface StoreHandle {
  el: HTMLElement;
  update(cfg: Partial<Pick<StoreCfg, "activeId">>): void;
}

/** brand tile: white plate for logo images, accent-soft for glyphs */
export function brandTile(it: { img?: string; icon?: string; accent?: string; color?: string }, dim: string): HTMLElement {
  const cls = it.img ? "nu-brand nu-brand--img" : "nu-brand";
  const tint = it.accent ?? it.color ?? "var(--accent)";
  return el(
    "span",
    { class: cls, style: `width:${dim};height:${dim};${it.img ? "" : `background:color-mix(in srgb, ${tint} 15%, var(--surface));color:${tint}`}` },
    it.img ? el("img", { src: it.img.replace(/^logos\//, "assets/logos/"), alt: "", class: "nu-brand-img" }) : icon(it.icon ?? "app", { size: "1.2rem" }),
  );
}

export function mountStore(host: Element, cfg: StoreCfg): StoreHandle {
  let activeId = cfg.activeId;
  let tab = "apps";
  let q = "";
  const on = new Set([...cfg.apps, ...cfg.agents].filter((x) => x.installed || x.enabled).map((x) => x.id));

  const root = el("div", { class: "nu-store" });
  host.appendChild(root);

  const search = input({
    placeholder: "Search the store",
    onInput(v) {
      q = v;
      renderShelf();
    },
  });
  const shelf = el("div", { class: "nu-store-scroll" });
  const tabsHost = el("div", { class: "nu-store-tabs" });

  root.appendChild(
    el(
      "div",
      { class: "nu-store-head" },
      el(
        "div",
        { class: "nu-store-headrow" },
        el(
          "div",
          {},
          el("h2", { class: "nu-store-h" }, "numu Store"),
          el("p", { class: "nu-store-sub" }, "Extend the workspace — install apps, enable agents, and connect sources. Everything lands as objects; on-device tools keep data on the page."),
        ),
        el("div", { class: "nu-store-search" }, search),
      ),
      tabsHost,
    ),
  );
  root.appendChild(shelf);

  mountTabs(tabsHost, {
    items: [
      { id: "apps", label: "Apps" },
      { id: "agents", label: "Agents" },
      { id: "connectors", label: "Connectors" },
    ],
    defaultValue: tab,
    onChange(v: string) {
      tab = v;
      renderShelf();
    },
  });

  const match = (it: { name: string; tagline?: string; cat?: string; kind?: string }): boolean => {
    const ql = q.trim().toLowerCase();
    return !ql || `${it.name} ${it.tagline ?? ""} ${it.cat ?? it.kind ?? ""}`.toLowerCase().includes(ql);
  };

  function act(it: ConsoleStoreApp, kind: "app" | "agent"): void {
    on.add(it.id);
    if (kind === "agent") cfg.onToast("Agent enabled", `${it.name} is now running in this workspace.`, "ok");
    else cfg.onToast("App installed", `${it.name} added to your workspace.`, "ok");
    renderShelf();
  }

  function openItem(it: ConsoleStoreApp, kind: "app" | "agent"): void {
    cfg.onOpen({ ...it, type: "storeItem", storeKind: kind === "agent" ? "Agent" : "App", on: on.has(it.id), onLabel: kind === "agent" ? "Enabled" : "Installed" });
  }

  function storeCard(it: ConsoleStoreApp, kind: "app" | "agent"): HTMLElement {
    const isOn = on.has(it.id);
    const doneLabel = kind === "agent" ? "Enabled" : "Installed";
    const getLabel = kind === "agent" ? "Enable" : "Get";
    const openLabel = kind === "agent" ? "Configure" : "Open";
    const actBtn = button({
      label: isOn ? openLabel : getLabel,
      size: "sm",
      variant: isOn ? "ghost" : undefined,
      onClick: (e) => {
        e.stopPropagation();
        isOn ? openItem(it, kind) : act(it, kind);
      },
    });
    return el(
      "div",
      { class: `nu-store-card${it.id === activeId ? " is-active" : ""}`, onclick: () => openItem(it, kind) },
      el(
        "div",
        { class: "nu-store-cardtop" },
        brandTile(it, "2.6rem"),
        el(
          "div",
          { class: "nu-store-cardmeta" },
          el(
            "div",
            { class: "nu-store-cardname" },
            it.name,
            it.claude ? el("img", { src: "assets/claude-mark.png", alt: "Claude", title: "Claude-powered", class: "nu-claude-mark" }) : null,
          ),
          el("div", { class: "nu-store-cardtags" }, badge({ label: it.cat }), it.badge ? badge({ label: it.badge, tone: "accent" }) : null),
        ),
      ),
      el("p", { class: "nu-store-tagline" }, it.tagline),
      el(
        "div",
        { class: "nu-store-cardfoot" },
        isOn ? el("span", { class: "nu-store-ondot" }, icon("check-circle-fill"), ` ${doneLabel}`) : null,
        el("span", { class: "nu-spring" }),
        actBtn,
      ),
    );
  }

  function renderShelf(): void {
    shelf.textContent = "";
    if (tab === "apps" || tab === "agents") {
      const list = (tab === "apps" ? cfg.apps : cfg.agents).filter(match);
      if (!list.length) {
        mountEmptyState(shelf, { title: `No ${tab} match`, line: `Nothing in ${tab === "apps" ? "Apps" : "Agents"} for “${q}”.` });
        return;
      }
      const grid = el("div", { class: "nu-store-grid" });
      list.forEach((it) => grid.appendChild(storeCard(it, tab === "apps" ? "app" : "agent")));
      shelf.appendChild(grid);
      return;
    }
    const conGroups = cfg.groups.map((g) => ({ ...g, items: g.items.filter(match) })).filter((g) => g.items.length);
    if (!conGroups.length) {
      mountEmptyState(shelf, { title: "No connectors match", line: `Nothing in Connectors for “${q}”.` });
      return;
    }
    conGroups.forEach((g) => {
      shelf.appendChild(el("div", { class: "nu-connectors-group" }, g.group));
      const grid = el("div", { class: "nu-connectors-grid" });
      g.items.forEach((it) => {
        grid.appendChild(
          el(
            "div",
            { class: `nu-connectors-tile${it.id === activeId ? " is-active" : ""}`, onclick: () => cfg.onOpen({ ...it, type: "connector" }) },
            brandTile(it, "2.6rem"),
            el(
              "span",
              { class: "nu-connectors-meta" },
              el("span", { class: "nu-connectors-name" }, it.name),
              el("span", { class: "nu-connectors-tags" }, badge({ label: it.kind }), it.local ? badge({ label: "on-device", tone: "accent" }) : null),
            ),
            it.connected
              ? el("span", { class: "nu-connectors-ok" }, icon("check-circle-fill"))
              : button({
                  label: "Connect",
                  size: "sm",
                  onClick: (e) => {
                    e.stopPropagation();
                    cfg.onOpen({ ...it, type: "connector" });
                  },
                }),
          ),
        );
      });
      shelf.appendChild(grid);
    });
  }

  renderShelf();
  return {
    el: root,
    update(partial) {
      if ("activeId" in partial) activeId = partial.activeId ?? null;
      renderShelf();
    },
  };
}

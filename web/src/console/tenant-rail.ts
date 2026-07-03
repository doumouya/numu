/* tenant-rail.ts — the far-left tenant rail: workspace buttons (mono monogram
   + active accent bar), then the chrome column (notifications · accent swap ·
   mode swap · connectors · settings) and the profile avatar. App-local .nu-*
   composition (amenan's mountRail is the 15rem text rail — different shape). */

import { el, icon } from "amenan-ui";

export interface TenantRailCfg {
  tenants: ConsoleTenant[];
  me: ConsoleData["me"];
  activeTenantId: string;
  page: "workspace" | "connectors";
  mode: "dark" | "light";
  accent: "numu" | "numu-blue";
  onTenant(id: string): void;
  onToggleAccent(): void;
  onToggleMode(): void;
  onConnectors(): void;
  onNotifications(): void;
  onSettings(): void;
  onProfile(): void;
}

export interface TenantRailHandle {
  el: HTMLElement;
  update(cfg: TenantRailCfg): void;
}

export function mountTenantRail(host: Element, cfg: TenantRailCfg): TenantRailHandle {
  const root = el("nav", { class: "nu-rail", "aria-label": "Workspaces" });
  host.appendChild(root);

  function chromeBtn(
    name: string,
    title: string,
    onclick: () => void,
    active = false,
    child?: Node,
  ): HTMLButtonElement {
    return el(
      "button",
      { class: `nu-rail-chrome${active ? " is-active" : ""}`, title, "aria-label": title, onclick },
      child ?? icon(name),
    );
  }

  function render(c: TenantRailCfg): void {
    root.textContent = "";
    c.tenants.forEach((t, i) => {
      const active = t.id === c.activeTenantId;
      const btn = el(
        "button",
        {
          class: `nu-rail-ws${active ? " is-active" : ""}`,
          title: t.name,
          "aria-label": t.name,
          style: `--nu-ws-accent:${t.accent}`,
          onclick: () => c.onTenant(t.id),
        },
        active ? el("span", { class: "nu-rail-ws-bar" }) : null,
        t.mark,
      );
      root.appendChild(btn);
      if (i === 0) root.appendChild(el("span", { class: "nu-rail-divider" }));
    });
    root.appendChild(el("span", { class: "nu-rail-spring" }));
    root.appendChild(chromeBtn("bell", "Notifications", c.onNotifications));
    root.appendChild(
      chromeBtn(
        "",
        c.accent === "numu" ? "Accent: ink → blue" : "Accent: blue → ink",
        c.onToggleAccent,
        false,
        el("span", { class: "nu-rail-accent-dot" }),
      ),
    );
    root.appendChild(
      chromeBtn(
        c.mode === "dark" ? "brightness-high" : "moon-stars",
        c.mode === "dark" ? "Light mode" : "Dark mode",
        c.onToggleMode,
      ),
    );
    root.appendChild(chromeBtn("plug", "Connectors", c.onConnectors, c.page === "connectors"));
    root.appendChild(chromeBtn("gear", "Settings", c.onSettings));
    root.appendChild(
      el(
        "button",
        { class: "nu-rail-me", title: c.me.role, "aria-label": "Profile", onclick: c.onProfile },
        el("span", { class: "nu-rail-me-initials" }, c.me.initials),
      ),
    );
  }

  render(cfg);
  return { el: root, update: render };
}

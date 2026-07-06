/* shell/rail.ts — THE APPS RAIL (console v2): the far-left strip. Sections,
   top to bottom: workspaces (the tenancy rule — sim canon today, real
   workspaces with the orgs slice) · the APP list from the registry (flyout
   with name+desc on pointer-fine hover/focus; taps just navigate) · spring ·
   Impersonate as an app-like entry at the foot (operator+sim only — enforced
   expiry + per-read audit stay the phase-B server contract). Absorbs the
   former console/impersonation-rail.ts. */

import { el, icon } from "amenan-ui";
import { appList, currentApp, onAppChange } from "./apps.ts";
import { navigate } from "./router.ts";

export interface ImpTarget {
  id: string;
  name: string;
  label: string;
}

export interface RailCfg {
  tenants: ConsoleTenant[];
  activeTenantId: string;
  impTargets: ImpTarget[];
  /** operator + engine only — false hides the impersonate entry entirely. */
  canImpersonate: boolean;
  onTenant(id: string): void;
  onImpersonate(t: ImpTarget): void;
}

export interface RailHandle {
  el: HTMLElement;
  update(cfg: RailCfg): void;
}

const FINE_POINTER = (): boolean => window.matchMedia("(pointer: fine)").matches;

export function mountRail(host: Element, cfg: RailCfg): RailHandle {
  const root = el("nav", { class: "nu-imp-rail", "aria-label": "Apps" });
  host.appendChild(root);
  let impOpen = false;
  let last = cfg;

  /* one flyout node, repositioned per hovered app (portfolio recipe) */
  const flyout = el("div", { class: "nu-rail-flyout", hidden: "hidden" });
  document.body.appendChild(flyout);
  function showFlyout(app: { icon: string; label: string; desc: string }, item: HTMLElement): void {
    if (!FINE_POINTER()) return;
    flyout.textContent = "";
    flyout.appendChild(el("span", { class: "nu-rail-flyout-icon" }, icon(app.icon)));
    flyout.appendChild(
      el("span", { class: "nu-rail-flyout-meta" },
        el("span", { class: "nu-rail-flyout-name" }, app.label),
        el("span", { class: "nu-rail-flyout-desc" }, app.desc)),
    );
    flyout.hidden = false;
    const r = item.getBoundingClientRect();
    flyout.style.left = `${r.right + 6}px`;
    flyout.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - flyout.getBoundingClientRect().height - 8))}px`;
  }
  const hideFlyout = (): void => {
    flyout.hidden = true;
  };

  function render(c: RailCfg): void {
    last = c;
    root.textContent = "";
    c.tenants.forEach((t, i) => {
      const active = t.id === c.activeTenantId;
      root.appendChild(
        el(
          "button",
          {
            class: `nu-imp-rail-ws${active ? " is-active" : ""}`,
            title: t.name,
            "aria-label": t.name,
            style: `--nu-ws-accent:${t.accent}`,
            onclick: () => c.onTenant(t.id),
          },
          active ? el("span", { class: "nu-imp-rail-ws-bar" }) : null,
          t.mark,
        ),
      );
      if (i === 0) root.appendChild(el("span", { class: "nu-imp-rail-divider" }));
    });

    /* the apps — the registry, ordered; the active app wears the accent */
    root.appendChild(el("span", { class: "nu-imp-rail-divider" }));
    appList().forEach((a) => {
      const active = currentApp() === a.id;
      const btn = el(
        "button",
        {
          class: `nu-rail-app${active ? " is-active" : ""}`,
          title: a.label,
          "aria-label": a.label,
          onclick: () => {
            hideFlyout();
            navigate(a.id);
          },
          onpointerenter: (e: Event) => showFlyout(a, e.currentTarget as HTMLElement),
          onpointerleave: hideFlyout,
          onfocus: (e: Event) => showFlyout(a, e.currentTarget as HTMLElement),
          onblur: hideFlyout,
        },
        icon(a.icon),
      );
      root.appendChild(btn);
    });

    root.appendChild(el("span", { class: "nu-imp-rail-spring" }));
    if (!c.canImpersonate) return;

    /* impersonate — an app-like entry at the foot; popover to the right */
    const pop = el("div", { class: "nu-imp-pop", hidden: "hidden" });
    pop.appendChild(el("div", { class: "nu-imp-head" }, "impersonate · see what they see"));
    if (c.impTargets.length) {
      c.impTargets.forEach((p) => {
        pop.appendChild(
          el(
            "button",
            { class: "nu-imp-item", onclick: () => { impOpen = false; c.onImpersonate(p); } },
            el("span", { class: "nu-ur-avatar nu-ur-avatar--sm", style: "background:var(--surface-2)" }, el("span", { class: "nu-imp-ini" }, p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase())),
            el("span", { class: "nu-imp-meta" }, el("span", { class: "nu-imp-name" }, p.name), el("span", { class: "nu-imp-label" }, p.label)),
            icon("eye"),
          ),
        );
      });
    } else {
      pop.appendChild(el("div", { class: "nu-imp-empty" }, "no other users yet — invite members in Settings"));
    }
    pop.appendChild(el("div", { class: "nu-imp-foot" }, "30 min grant · purpose: support · start/end logged"));

    const impBtn = el(
      "button",
      {
        class: `nu-rail-app${impOpen ? " is-active" : ""}`,
        title: "Impersonate · view as user",
        "aria-label": "Impersonate",
        onclick: (e: Event) => {
          e.stopPropagation();
          impOpen = !impOpen;
          pop.hidden = !impOpen;
          impBtn.classList.toggle("is-active", impOpen);
        },
      },
      icon("person-bounding-box"),
    );
    document.addEventListener("mousedown", (e) => {
      if (impOpen && !pop.contains(e.target as Node) && e.target !== impBtn) {
        impOpen = false;
        pop.hidden = true;
        impBtn.classList.remove("is-active");
      }
    });
    root.appendChild(el("span", { class: "nu-imp-anchor" }, pop, impBtn));
  }

  onAppChange(() => render(last));
  render(cfg);
  return { el: root, update: render };
}

/* impersonation-rail.ts — THE IMPERSONATION RAIL: numu-operator chrome ONLY.
   A client (LORVCLE) member never sees this rail — they get only the Object
   Rail. Clicking a client workspace opens that client's world; "Impersonate ·
   view as user" at the bottom connects the operator as one of THAT workspace's
   users — a troubleshooting tool (RBAC design §3.3: explicit, purpose-tagged,
   time-bound, logged — never a silent bypass). Hidden entirely while
   viewing-as. */

import { el, icon } from "amenan-ui";

export interface ImpTarget {
  id: string;
  name: string;
  label: string;
}

export interface ImpersonationRailCfg {
  tenants: ConsoleTenant[];
  activeTenantId: string;
  impTargets: ImpTarget[];
  onTenant(id: string): void;
  onImpersonate(t: ImpTarget): void;
}

export interface ImpersonationRailHandle {
  el: HTMLElement;
  update(cfg: ImpersonationRailCfg): void;
}

export function mountImpersonationRail(host: Element, cfg: ImpersonationRailCfg): ImpersonationRailHandle {
  const root = el("nav", { class: "nu-imp-rail", "aria-label": "Workspaces" });
  host.appendChild(root);
  let impOpen = false;

  function render(c: ImpersonationRailCfg): void {
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
    root.appendChild(el("span", { class: "nu-imp-rail-spring" }));

    /* impersonate — popover to the right of the rail */
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
    pop.appendChild(el("div", { class: "nu-imp-foot" }, "30 min grant · purpose: support · every read logged"));

    const impBtn = el(
      "button",
      {
        class: `nu-chrome-btn${impOpen ? " is-active" : ""}`,
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

  render(cfg);
  return { el: root, update: render };
}

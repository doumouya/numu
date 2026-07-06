/* shell/layout.ts — the four-region skeleton (docs/frontend/CONSOLE.md):
   Apps Rail host (far-left strip) · topbar · Object Rail host · center (the
   kept-alive app surfaces + the composer docked under every page) · Context
   panel host (27rem ⇄ full width — half-open IS the mobile view). Built once;
   regions are hidden-toggled, never rebuilt. */

import { el } from "amenan-ui";

export interface Layout {
  appRoot: HTMLElement;
  railHost: HTMLElement;
  banner: HTMLElement;
  topbar: HTMLElement;
  objectRailHost: HTMLElement;
  centerHost: HTMLElement;
  centerCol: HTMLElement;
  composerHost: HTMLElement;
  contextHost: HTMLElement;
  /** Create + attach a kept-alive center surface (an app's canvas). */
  addSurface(className: string): HTMLElement;
}

export function buildLayout(rootHost: HTMLElement): Layout {
  const railHost = el("div", { class: "nu-imp-rail-host" });
  const banner = el("div", { class: "nu-imp-banner", hidden: "hidden" });
  const topbar = el("header", { class: "nu-topbar" });
  const objectRailHost = el("div", { class: "nu-panel-host" });
  const centerHost = el("main", { class: "nu-center" });
  const contextHost = el("div", { class: "nu-context-host" });
  const body = el("div", { class: "nu-body" }, objectRailHost, centerHost, contextHost);
  const appRoot = el(
    "div",
    { class: "nu-app" },
    railHost,
    el("div", { class: "nu-main" }, banner, topbar, body),
  );
  rootHost.appendChild(appRoot);

  const composerHost = el("div", { class: "nu-composer-host" });
  const centerCol = el("div", { class: "nu-center-col" }, composerHost);
  centerHost.appendChild(centerCol);

  return {
    appRoot,
    railHost,
    banner,
    topbar,
    objectRailHost,
    centerHost,
    centerCol,
    composerHost,
    contextHost,
    addSurface(className: string): HTMLElement {
      const surface = el("div", { class: className, hidden: "hidden" });
      centerCol.insertBefore(surface, composerHost);
      return surface;
    },
  };
}

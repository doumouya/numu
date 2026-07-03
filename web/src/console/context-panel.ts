/* context-panel.ts — the right Context panel: mobile-width by default with an
   expand button to full width, swapping to a TYPE-SPECIFIC viewer for the
   current element — audio player · video player · image gallery · dashboard ·
   case/record detail (workflow stepper) · connector config · app (iframe).
   Media are on-brand placeholder surfaces (real assets land in production). */

import { el, icon, badge, button, mountCode, mountField, input } from "amenan-ui";
import type { BadgeTone } from "amenan-ui";
import { mountNuChart } from "./chart-theme.ts";

const STATUS_TONE: Record<string, BadgeTone | undefined> = {
  in_review: "warn",
  pending: "warn",
  done: "ok",
  paid: "ok",
  refunded: "danger",
};

export interface ContextPanelCfg {
  object: ConsoleObject | (ConsoleConnector & { type: "connector" }) | null;
  expanded: boolean;
  onExpand(): void;
  onClose(): void;
}

export interface ContextPanelHandle {
  el: HTMLElement;
  update(cfg: ContextPanelCfg): void;
}

function scrubber(pct: number, pos: string, dur: string): HTMLElement {
  return el(
    "div",
    { class: "nu-scrub" },
    el("span", { class: "nu-scrub-time" }, pos),
    el(
      "div",
      { class: "nu-scrub-track" },
      el("span", { class: "nu-scrub-fill", style: `width:${pct}%` }),
      el("span", { class: "nu-scrub-knob", style: `left:calc(${pct}% - 0.35rem)` }),
    ),
    el("span", { class: "nu-scrub-time" }, dur),
  );
}

function mediaSurface(ratio: string, glyph: string): HTMLElement {
  return el(
    "div",
    { class: "nu-media", style: `aspect-ratio:${ratio}` },
    icon(glyph, { size: "2.4rem" }),
    el("div", { class: "nu-media-overlay" }, el("span", { class: "nu-media-play" }, icon("play-fill", { size: "1.6rem" }))),
  );
}

function ctlBtn(glyph: string, size = "1.1rem", big = false): HTMLElement {
  return el("button", { class: big ? "nu-media-bigplay" : "nu-media-ctl", "aria-label": glyph }, icon(glyph, { size }));
}

function appViewer(o: ConsoleObject, expanded: boolean): HTMLElement {
  return el("iframe", {
    src: o.src ?? "",
    title: o.name,
    class: `nu-viewer-app${expanded ? " is-expanded" : ""}`,
  });
}

function dashboardViewer(o: ConsoleObject, expanded: boolean): HTMLElement {
  const grid = el("div", { class: `nu-viewer-dash${expanded ? " is-expanded" : ""}` });
  (o.charts ?? []).forEach((ch) => {
    const tile = el("div", { class: "nu-dash-tile nu-dash-tile--panel" }, el("span", { class: "nu-dash-nacl" }, ch.nacl));
    const slot = el("div", { class: `nu-dash-chart${expanded ? " is-tall" : ""}` });
    tile.appendChild(slot);
    mountNuChart(slot, ch);
    grid.appendChild(tile);
  });
  return grid;
}

function connectorViewer(o: ConsoleConnector & { type: "connector" }, expanded: boolean): HTMLElement {
  const isDb = o.kind === "Database" || o.kind === "On-device";
  const wrap = el("div", { class: "nu-viewer-stack" });
  wrap.appendChild(
    el(
      "div",
      { class: "nu-conn-head" },
      el("span", { class: "nu-connectors-badge", style: `background:${o.color}` }, icon(o.icon)),
      el(
        "span",
        { class: "nu-conn-id" },
        el("span", { class: "nu-conn-name" }, o.name),
        el("span", { class: "nu-conn-kind" }, o.kind),
      ),
      el("span", { class: "nu-spring" }),
      badge({ label: o.connected ? "connected" : "not connected", tone: o.connected ? "ok" : undefined }),
    ),
  );
  if (isDb) {
    const grid = el("div", { class: `nu-conn-grid${expanded ? " is-expanded" : ""}` });
    const fields: Array<[string, string]> = [
      ["host", o.host ?? o.store ?? "localhost"],
      ["port", o.port ?? "—"],
      ["database", o.database ?? (o.tables ? `${o.tables} tables` : "—")],
      ["user", o.user ?? "on-device"],
    ];
    fields.forEach(([label, value]) => {
      mountField(grid, { label, control: input({ value }) });
    });
    const sec = el("div", {}, el("div", { class: "nu-sec-label" }, "connection"));
    sec.appendChild(grid);
    wrap.appendChild(sec);
    const cs = el("div", {}, el("div", { class: "nu-sec-label" }, "connection string"));
    mountCode(cs, {
      text: o.host
        ? `postgresql://${o.user}:••••@${o.host}:${o.port}/${o.database}?sslmode=${o.ssl}`
        : "gluesql://browser · IndexedDB — data never leaves the page",
      block: true,
    });
    wrap.appendChild(cs);
    wrap.appendChild(
      el(
        "div",
        { class: "nu-viewer-actions" },
        button({ label: "Test connection", icon: "bi-plug", variant: "accent", size: "sm" }),
        button({ label: "Disconnect", size: "sm" }),
      ),
    );
  } else {
    const acct = el("div", {}, el("div", { class: "nu-sec-label" }, "account"));
    const rows: Array<[string, string]> = [
      ["account", o.account ?? "studio@orvcle.io"],
      ["scopes", o.scopes ?? "read · sync"],
      ["last sync", o.lastSync ?? "just now"],
    ];
    rows.forEach(([k, v]) => {
      acct.appendChild(el("div", { class: "nu-field-row" }, el("span", { class: "nu-field-k" }, k), el("span", { class: "nu-field-v" }, v)));
    });
    wrap.appendChild(acct);
    wrap.appendChild(
      el(
        "div",
        { class: "nu-viewer-actions" },
        button({ label: "Reconnect", icon: "bi-arrow-repeat", variant: "accent", size: "sm" }),
        button({ label: "Disconnect", size: "sm" }),
      ),
    );
  }
  return wrap;
}

function videoViewer(o: ConsoleObject): HTMLElement {
  return el(
    "div",
    { class: "nu-viewer-stack" },
    mediaSurface("16 / 9", "camera-video"),
    el(
      "div",
      { class: "nu-viewer-stack nu-viewer-stack--tight" },
      scrubber(o.posPct ?? 0, o.pos ?? "0:00", o.duration ?? "—"),
      el(
        "div",
        { class: "nu-media-bar" },
        ctlBtn("skip-start-fill"),
        ctlBtn("pause-fill", "1.3rem", true),
        ctlBtn("skip-end-fill"),
        el("span", { class: "nu-spring" }),
        ctlBtn("volume-up-fill", "1.05rem"),
        ctlBtn("fullscreen", "1rem"),
      ),
    ),
  );
}

function audioViewer(o: ConsoleObject, expanded: boolean): HTMLElement {
  return el(
    "div",
    { class: "nu-viewer-audio" },
    el("div", { class: `nu-media nu-media--art${expanded ? " is-expanded" : ""}` }, icon("music-note-beamed", { size: "3rem" })),
    el(
      "div",
      { class: "nu-viewer-titleblock" },
      el("div", { class: "nu-viewer-title" }, o.name),
      el("div", { class: "nu-viewer-sub" }, o.artist ?? ""),
    ),
    el(
      "div",
      { class: "nu-media-controls" },
      scrubber(o.posPct ?? 0, o.pos ?? "0:00", o.duration ?? "—"),
      el(
        "div",
        { class: "nu-media-row" },
        ctlBtn("shuffle", "1rem"),
        ctlBtn("skip-start-fill", "1.3rem"),
        ctlBtn("play-fill", "1.4rem", true),
        ctlBtn("skip-end-fill", "1.3rem"),
        ctlBtn("repeat", "1rem"),
      ),
    ),
  );
}

function imageViewer(o: ConsoleObject, expanded: boolean): HTMLElement {
  const n = o.gallery ?? 5;
  const thumbs = el("div", { class: "nu-thumbs" });
  for (let i = 0; i < n; i++) {
    thumbs.appendChild(el("span", { class: `nu-thumb${i === 0 ? " is-active" : ""}` }, icon("image", { size: "1rem" })));
  }
  return el(
    "div",
    { class: "nu-viewer-stack" },
    el("div", { class: `nu-media nu-media--hero${expanded ? " is-expanded" : ""}` }, icon("image", { size: "2.4rem" })),
    el(
      "div",
      { class: "nu-viewer-titleblock" },
      el("div", { class: "nu-viewer-title nu-viewer-title--xl" }, o.name),
      el("div", { class: "nu-viewer-sub" }, o.meta ?? ""),
    ),
    el("div", {}, el("div", { class: "nu-sec-label" }, `${n} photos`), thumbs),
  );
}

function detailViewer(o: ConsoleObject): HTMLElement {
  const states = ["backlog", "in_progress", "in_review", "done"];
  const isCase = o.type === "case";
  const idx = states.indexOf(o.status ?? "");
  const wrap = el("div", { class: "nu-viewer-stack" });

  const idRow = el("div", { class: "nu-detail-idrow" });
  if (o.code) mountCode(idRow, { text: o.code });
  if (o.status) idRow.appendChild(badge({ label: o.status, tone: STATUS_TONE[o.status] }));
  wrap.appendChild(idRow);
  wrap.appendChild(el("div", { class: "nu-viewer-title nu-viewer-title--xl" }, o.name));

  if (isCase) {
    const stepper = el("div", { class: "nu-stepper" });
    states.forEach((s, i) => {
      const st = i < idx ? "done" : i === idx ? "current" : "todo";
      stepper.appendChild(
        el("span", { class: `nu-step nu-step--${st}` }, st === "done" ? icon("check", { size: "0.72rem" }) : null, s),
      );
      if (i < states.length - 1) stepper.appendChild(el("span", { class: "nu-step-link" }));
    });
    wrap.appendChild(el("div", {}, el("div", { class: "nu-sec-label" }, "workflow"), stepper));
  }

  const fields = el("div", {}, el("div", { class: "nu-sec-label" }, "fields"));
  (o.fields ?? []).forEach(([k, v]) => {
    fields.appendChild(el("div", { class: "nu-field-row" }, el("span", { class: "nu-field-k" }, k), el("span", { class: "nu-field-v" }, v)));
  });
  wrap.appendChild(fields);

  wrap.appendChild(
    el(
      "div",
      { class: "nu-viewer-actions" },
      button({ icon: "bi-pencil", title: "Edit" }),
      button({ icon: "bi-box-arrow-up-right", title: "Open" }),
      button({ icon: "bi-three-dots", title: "More", variant: "ghost" }),
    ),
  );
  return wrap;
}

function viewer(o: NonNullable<ContextPanelCfg["object"]>, expanded: boolean): HTMLElement {
  switch (o.type) {
    case "app":
      return appViewer(o as ConsoleObject, expanded);
    case "dashboard":
      return dashboardViewer(o as ConsoleObject, expanded);
    case "connector":
      return connectorViewer(o as ConsoleConnector & { type: "connector" }, expanded);
    case "video":
      return videoViewer(o as ConsoleObject);
    case "audio":
      return audioViewer(o as ConsoleObject, expanded);
    case "image":
      return imageViewer(o as ConsoleObject, expanded);
    default:
      return detailViewer(o as ConsoleObject);
  }
}

export function mountContextPanel(host: Element, cfg: ContextPanelCfg): ContextPanelHandle {
  const root = el("aside", { class: "nu-context", hidden: "hidden" });
  host.appendChild(root);

  function render(c: ContextPanelCfg): void {
    root.textContent = "";
    if (!c.object) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.classList.toggle("is-expanded", c.expanded);
    const o = c.object;
    const accent = "accent" in o && o.accent ? o.accent : "color" in o ? o.color : "var(--accent)";
    root.appendChild(
      el(
        "div",
        { class: "nu-context-head" },
        el("span", { class: "nu-tag", style: `color:${accent};border-color:${accent}` }, o.type),
        el("span", { class: "nu-context-title" }, o.name),
        el("span", { class: "nu-spring" }),
        button({
          icon: c.expanded ? "bi-arrows-angle-contract" : "bi-arrows-angle-expand",
          variant: "ghost",
          size: "sm",
          title: c.expanded ? "Collapse" : "Expand full width",
          onClick: c.onExpand,
        }),
        button({ icon: "bi-x-lg", variant: "ghost", size: "sm", title: "Close", onClick: c.onClose }),
      ),
    );
    const body = el("div", { class: `nu-context-body${c.expanded ? " is-expanded" : ""}` });
    body.appendChild(viewer(o, c.expanded));
    root.appendChild(body);
  }

  render(cfg);
  return { el: root, update: render };
}

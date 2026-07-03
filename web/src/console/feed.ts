/* feed.ts — the conversation canvas: the typed block renderers (email · step ·
   data-profile · dashboard · object · bubbles) in one .nu-card CSS family.
   Ported from the design project's ConsoleFeed blocks; charts render through
   amenan's mountChart with token-synthesized options (chart-theme.ts). */

import { el, icon, badge, button, mountKindLabel } from "amenan-ui";
import type { KindLabelKind } from "amenan-ui";
import { mountNuChart } from "./chart-theme.ts";

export interface FeedCfg {
  feed: NumuBlock[];
  onOpenObject(b: NumuObjectBlock): void;
  onOpenTableRow(r: NumuObjectTableRow): void;
  onSaveAttachment(b: NumuEmailBlock): void;
}

export interface FeedHandle {
  el: HTMLElement;
  update(cfg: FeedCfg): void;
  /** pin the scroll to the newest block (called after appends) */
  scrollToEnd(): void;
}

function kindOf(dtype: string): KindLabelKind {
  const d = dtype.toLowerCase();
  return d === "int" ? "Int" : d === "float" ? "Float" : d === "bool" ? "Bool" : "Text";
}

function cardHead(...children: Array<Node | string | null>): HTMLElement {
  return el("div", { class: "nu-card-head" }, ...children);
}

function tag(text: string, colorVar?: string): HTMLElement {
  return el("span", { class: "nu-tag", style: colorVar ? `color:${colorVar};border-color:${colorVar}` : null }, text);
}

function emailBlock(b: NumuEmailBlock, onSave: FeedCfg["onSaveAttachment"]): HTMLElement {
  const att = b.attachment;
  return el(
    "div",
    { class: "nu-card nu-card--email" },
    cardHead(
      icon("envelope", { color: "var(--accent)", size: "0.9rem" }),
      tag("email"),
      el("span", { class: "nu-card-meta" }, `${b.from} · ${b.time}`),
    ),
    el(
      "div",
      { class: "nu-card-body" },
      el("span", { class: "nu-email-subject" }, b.subject),
      el("span", { class: "nu-email-text" }, b.text),
      att
        ? el(
            "div",
            { class: "nu-attachment" },
            icon("filetype-csv", { color: "var(--accent)", size: "1.1rem" }),
            el("span", { class: "nu-attachment-name" }, att.name),
            el("span", { class: "nu-card-meta" }, `${att.size} · ${att.rows} rows`),
            el("span", { class: "nu-spring" }),
            att.saved
              ? el("span", { class: "nu-attachment-saved" }, "saved · on device")
              : button({ label: "Save to chat", icon: "bi-download", variant: "accent", size: "sm", onClick: () => onSave(b) }),
          )
        : null,
    ),
  );
}

function stepBlock(b: NumuStepBlock): HTMLElement {
  return el(
    "div",
    { class: "nu-card" },
    cardHead(
      el("span", { class: "nu-prompt-glyph" }, "›"),
      el("span", { class: "nu-nacl" }, b.nacl),
      el("span", { class: "nu-spring" }),
      tag(b.kind),
    ),
    el(
      "div",
      { class: "nu-step-impact" },
      icon(b.kind === "warn" ? "exclamation-triangle-fill" : "check2", {
        color: b.kind === "warn" ? "var(--warn)" : "var(--ok)",
        size: "0.85rem",
      }),
      el("span", {}, b.impact),
    ),
  );
}

function dataBlock(b: NumuDataBlock): HTMLElement {
  const stats: Array<[string, string]> = [
    ["rows", b.rows],
    ["cols", b.cols],
    ["null rows", b.nulls],
    ["junk", b.junk],
  ];
  const colList = el("div", { class: "nu-data-cols" });
  (b.columns ?? []).forEach((c) => {
    const row = el(
      "div",
      { class: "nu-data-col" },
      el("span", { class: "nu-data-col-name", title: c.full ?? c.name }, c.name),
    );
    mountKindLabel(row, { kind: kindOf(c.dtype) });
    row.appendChild(el("span", { class: "nu-spring" }));
    row.appendChild(el("span", { class: "nu-data-col-null" }, `${c.nullPct} null`));
    colList.appendChild(row);
  });
  const head = cardHead(
    icon("filetype-csv", { color: "var(--accent)", size: "0.9rem" }),
    el("span", { class: "nu-card-title" }, b.name),
    el("span", { class: "nu-card-meta" }, b.source),
    el("span", { class: "nu-spring" }),
  );
  const okBadge = badge({ label: "on device", tone: "ok" });
  head.appendChild(okBadge);
  return el(
    "div",
    { class: "nu-card" },
    head,
    el(
      "div",
      { class: "nu-data-stats" },
      ...stats.map(([k, v]) =>
        el("div", { class: "nu-data-stat" }, el("span", { class: "nu-data-stat-k" }, k), el("span", { class: "nu-data-stat-v" }, v)),
      ),
    ),
    colList,
  );
}

function dashboardBlock(b: NumuDashboardBlock): HTMLElement {
  const grid = el("div", { class: "nu-dash-grid" });
  b.charts.forEach((ch) => {
    const tile = el("div", { class: "nu-dash-tile" }, el("span", { class: "nu-dash-nacl" }, ch.nacl));
    const slot = el("div", { class: "nu-dash-chart" });
    tile.appendChild(slot);
    mountNuChart(slot, ch);
    grid.appendChild(tile);
  });
  return el(
    "div",
    { class: "nu-card nu-card--dash" },
    cardHead(
      icon("grid-1x2", { color: "var(--accent)", size: "0.9rem" }),
      el("span", { class: "nu-card-title" }, b.name),
      tag("dashboard"),
      el("span", { class: "nu-spring" }),
      el("span", { class: "nu-card-meta" }, `${b.charts.length} chart${b.charts.length === 1 ? "" : "s"}`),
    ),
    grid,
  );
}

function objectTableBlock(b: NumuObjectTableBlock, onOpenRow: FeedCfg["onOpenTableRow"]): HTMLElement {
  const list = el("div", { class: "nu-otable-rows" });
  b.rows.forEach((r) => {
    list.appendChild(
      el(
        "button",
        { class: "nu-otable-row", onclick: () => onOpenRow(r) },
        tag(b.objType, "var(--accent)"),
        el("span", { class: "nu-otable-title" }, r.title),
        r.status ? badge({ label: r.status }) : null,
        el("span", { class: "nu-otable-meta" }, r.meta),
        icon("chevron-right", { size: "0.7rem", color: "var(--text-mute)" }),
      ),
    );
  });
  return el(
    "div",
    { class: "nu-card nu-card--otable" },
    cardHead(
      icon(b.icon ?? "collection", { color: "var(--accent)", size: "0.95rem" }),
      el("span", { class: "nu-card-title nu-otable-head" }, b.title),
    ),
    list,
  );
}

function objectBlock(b: NumuObjectBlock, onOpen: FeedCfg["onOpenObject"]): HTMLElement {
  return el(
    "button",
    { class: "nu-objcard", style: `--nu-obj-accent:${b.accentColor}`, onclick: () => onOpen(b) },
    el("span", { class: "nu-objcard-icon" }, icon(b.objIcon, { size: "1.2rem" })),
    el(
      "span",
      { class: "nu-objcard-meta" },
      el("span", { class: "nu-objcard-line" }, tag(b.objType, b.accentColor), el("span", { class: "nu-objcard-title" }, b.title)),
      el("span", { class: "nu-objcard-sub" }, b.meta),
    ),
    el("span", { class: "nu-spring" }),
    icon("box-arrow-up-right", { color: b.accentColor, size: "0.9rem" }),
  );
}

function bubbleBlock(b: NumuBubbleBlock): HTMLElement {
  const sent = b.type === "sent";
  return el(
    "div",
    { class: `nu-bubble-wrap${sent ? " is-sent" : ""}` },
    el(
      "div",
      { class: "nu-bubble-meta" },
      b.clientTag ? tag(b.clientTag, b.clientColor) : null,
      sent && b.channel ? tag(b.channel) : null,
      el("span", {}, sent ? "You · now" : `${b.author ?? ""} · ${b.time ?? ""}`),
    ),
    el("div", { class: `nu-bubble${sent ? " is-sent" : ""}` }, b.text),
    b.react ? el("span", { class: "nu-bubble-react" }, icon("hand-thumbs-up", { size: "0.7rem" }), b.react) : null,
  );
}

export function renderBlock(b: NumuBlock, cfg: FeedCfg): HTMLElement {
  switch (b.type) {
    case "email":
      return emailBlock(b, cfg.onSaveAttachment);
    case "step":
      return stepBlock(b);
    case "data":
      return dataBlock(b);
    case "dashboard":
      return dashboardBlock(b);
    case "object":
      return objectBlock(b, cfg.onOpenObject);
    case "objectTable":
      return objectTableBlock(b, cfg.onOpenTableRow);
    default:
      return bubbleBlock(b);
  }
}

export function mountFeed(host: Element, cfg: FeedCfg): FeedHandle {
  const scroll = el("div", { class: "nu-feed-scroll" });
  host.appendChild(scroll);

  function render(c: FeedCfg): void {
    scroll.textContent = "";
    c.feed.forEach((b) => scroll.appendChild(renderBlock(b, c)));
  }

  render(cfg);
  return {
    el: scroll,
    update: render,
    scrollToEnd() {
      scroll.scrollTop = scroll.scrollHeight;
    },
  };
}

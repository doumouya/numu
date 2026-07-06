/* cv-preview.ts — a live HTML preview of the CV doc that mirrors the genpdf layout
   (crates/apps/portfolio/src/pdf.rs): bold name · accent headline · muted contact · accent
   links · summary + entries with inline mini-md · uppercase accent section rules · head-left
   dates-right entries · accent bullets. What you see here is what Publish renders. */

import { el } from "amenan-ui";
import { renderInline } from "./md-inline.ts";

interface CvLink { label?: string; href?: string }
interface CvEntry { head?: string; when?: string; sub?: string; bullets?: string[] }
interface CvSection { title?: string; entries?: CvEntry[] }
interface CvDoc { name?: string; headline?: string; contact?: string; summary?: string; links?: CvLink[]; sections?: CvSection[] }

export function renderCvPreview(host: HTMLElement, doc: CvDoc): void {
  host.textContent = "";
  const page = el("div", { class: "nu-cvp" });

  page.appendChild(el("div", { class: "nu-cvp-name" }, doc.name || "Your Name"));
  if (doc.headline) page.appendChild(el("div", { class: "nu-cvp-headline" }, doc.headline));
  if (doc.contact) page.appendChild(el("div", { class: "nu-cvp-contact" }, doc.contact));
  const links = (doc.links ?? []).map((l) => l.label).filter(Boolean) as string[];
  if (links.length) page.appendChild(el("div", { class: "nu-cvp-links" }, links.join("  ·  ")));
  if (doc.summary) page.appendChild(el("p", { class: "nu-cvp-summary" }, renderInline(doc.summary)));

  (doc.sections ?? []).forEach((sec) => {
    page.appendChild(el("div", { class: "nu-cvp-sectitle" }, (sec.title || "").toUpperCase()));
    (sec.entries ?? []).forEach((en) => {
      const head = el("div", { class: "nu-cvp-entryhead" });
      if (en.head) head.appendChild(el("span", { class: "nu-cvp-head" }, renderInline(en.head)));
      if (en.when) head.appendChild(el("span", { class: "nu-cvp-when" }, en.when));
      if (en.head || en.when) page.appendChild(head);
      if (en.sub) page.appendChild(el("div", { class: "nu-cvp-sub" }, renderInline(en.sub)));
      (en.bullets ?? []).forEach((b) => {
        if (b) page.appendChild(el("div", { class: "nu-cvp-bullet" }, el("span", { class: "nu-cvp-dot" }, "•"), renderInline(b)));
      });
    });
  });

  host.appendChild(page);
}

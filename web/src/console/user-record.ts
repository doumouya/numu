/* user-record.ts — ONE layout, embedded in the Context panel: the signed-in
   user (editable) or any other user (read-only record + Impersonate). Editing
   is inline (click a field, Enter/blur saves) — the "Profile == Record"
   principle: a profile is just the user object rendered by the same viewer. */

import { el, icon, badge, button } from "amenan-ui";
import type { BadgeTone } from "amenan-ui";

const STATUS_TONE: Record<string, BadgeTone | undefined> = { active: "ok", invited: "warn", disabled: "danger" };
const KYC_TONE: Record<string, BadgeTone | undefined> = { verified: "ok", pending: "warn", rejected: "danger", none: undefined };
const KIND_ICON: Record<string, string> = { human: "person", agent: "robot", service: "gear-wide-connected" };
const ROLE_TONE: Record<string, BadgeTone | undefined> = { admin: "accent", operator: "accent", owner: "accent", member: "info", guest: "warn" };

export interface UserRecordCfg {
  user: ConsoleUserRecordData;
  editable: boolean;
  canImpersonate: boolean;
  onImpersonate(u: ConsoleUserRecordData): void;
  onToast(title: string, msg: string, tone?: string): void;
}

export function renderUserRecord(host: Element, cfg: UserRecordCfg): void {
  const { user } = cfg;
  const vals: Record<string, string> = {
    email: user.email,
    phone: user.phone,
    country: user.country,
    notes: user.notes,
  };
  const canEdit = cfg.editable;

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const wrap = el("div", { class: "nu-ur" });
  host.appendChild(wrap);

  function secLabel(glyph: string, text: string): HTMLElement {
    return el("div", { class: "nu-sec-label nu-ur-seclabel" }, icon(glyph, { size: "0.8rem" }), text);
  }

  function fieldRow(k: string, label: string): HTMLElement {
    const row = el("div", { class: "nu-field-row nu-ur-field" }, el("span", { class: "nu-field-k" }, label));
    const display = (): void => {
      const old = row.querySelector(".nu-ur-fv");
      old?.remove();
      if (canEdit) {
        const btn = el(
          "button",
          { class: "nu-ur-fv nu-ur-fvbtn", title: `Edit ${label}`, onclick: () => edit() },
          el("span", { class: "nu-ur-fvtext" }, vals[k] || "—"),
          icon("pencil", { size: "0.62rem", color: "var(--text-mute)" }),
        );
        row.appendChild(btn);
      } else {
        row.appendChild(el("span", { class: "nu-field-v nu-ur-fv" }, vals[k] || "—"));
      }
    };
    const edit = (): void => {
      const old = row.querySelector(".nu-ur-fv");
      old?.remove();
      const input = el("input", { class: "nu-ur-input nu-ur-fv", value: vals[k] ?? "" });
      const commit = (): void => {
        vals[k] = input.value;
        display();
        cfg.onToast("Saved", `${label} updated · on device`, "ok");
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") display();
      });
      input.addEventListener("blur", commit);
      row.appendChild(input);
      input.focus();
    };
    display();
    return row;
  }

  /* header */
  const header = el(
    "div",
    { class: "nu-ur-head" },
    el(
      "div",
      { class: "nu-ur-idrow" },
      el("span", { class: "nu-ur-avatar", style: `background:${user.accent}` }, el("span", { class: "nu-ur-avatxt" }, initials)),
      el(
        "div",
        { class: "nu-ur-id" },
        el("span", { class: "nu-ur-name" }, user.name),
        el("span", { class: "nu-ur-handle" }, `@${user.handle} · ${user.role}`),
        el(
          "span",
          { class: "nu-ur-badges" },
          badge({ label: user.status, tone: STATUS_TONE[user.status] }),
          el("span", { class: "nu-ur-kind" }, icon(KIND_ICON[user.kind] ?? "person", { size: "0.7rem" }), user.kind),
        ),
      ),
    ),
  );
  if (cfg.canImpersonate && !user.self && user.kind === "human") {
    header.appendChild(
      el(
        "div",
        { class: "nu-ur-actions" },
        button({ label: "Impersonate", icon: "bi-eye", variant: "accent", size: "sm", onClick: () => cfg.onImpersonate(user) }),
        button({ label: "Message", icon: "bi-chat-dots", size: "sm", onClick: () => cfg.onToast("Message", `Open a thread with ${user.name}`) }),
      ),
    );
  }
  wrap.appendChild(header);

  /* contact */
  const contact = el("div", {}, secLabel("person-lines-fill", "contact"));
  const contactCard = el("div", { class: "nu-ur-card" }, fieldRow("email", "email"), fieldRow("phone", "phone"), fieldRow("country", "country"));
  contactCard.appendChild(
    el("div", { class: "nu-field-row nu-ur-field nu-ur-field--last" }, el("span", { class: "nu-field-k" }, "locale"), el("span", { class: "nu-field-v" }, user.locale)),
  );
  contact.appendChild(contactCard);
  wrap.appendChild(contact);

  /* memberships */
  const mem = el("div", {}, secLabel("diagram-3", "roles & memberships"));
  const memCard = el("div", { class: "nu-ur-card" });
  user.memberships.forEach((m, i) => {
    memCard.appendChild(
      el(
        "div",
        { class: `nu-ur-row${i === user.memberships.length - 1 ? " nu-ur-row--last" : ""}` },
        icon("building", { size: "0.95rem", color: "var(--text-mute)" }),
        el("span", { class: "nu-ur-rowmeta" }, el("span", { class: "nu-ur-rowname" }, m.org), el("span", { class: "nu-ur-rowsub" }, m.team)),
        badge({ label: m.role, tone: ROLE_TONE[m.role] }),
      ),
    );
  });
  mem.appendChild(memCard);
  wrap.appendChild(mem);

  /* kyc */
  const kycTone = KYC_TONE[user.kyc.status];
  const kyc = el(
    "div",
    {},
    secLabel("patch-check", "verification · kyc"),
    el(
      "div",
      { class: "nu-ur-card nu-ur-kyc" },
      icon(user.kyc.status === "verified" ? "patch-check-fill" : user.kyc.status === "rejected" ? "patch-exclamation-fill" : "patch-question", {
        size: "1.6rem",
        color: kycTone === "ok" ? "var(--ok)" : kycTone === "warn" ? "var(--warn)" : kycTone === "danger" ? "var(--danger)" : "var(--text-mute)",
      }),
      el(
        "div",
        { class: "nu-ur-rowmeta" },
        el("span", {}, badge({ label: user.kyc.status, tone: kycTone })),
        el("span", { class: "nu-ur-rowsub" }, `${user.kyc.method} · ${user.kyc.date}`),
      ),
      canEdit && user.kyc.status !== "verified"
        ? button({ label: "Verify", icon: "bi-patch-check", variant: "accent", size: "sm", onClick: () => cfg.onToast("Verification", "Continue KYC flow") })
        : null,
    ),
  );
  wrap.appendChild(kyc);

  /* activity */
  const act = el("div", {}, secLabel("activity", "recent activity"));
  const actCard = el("div", { class: "nu-ur-card" });
  user.activity.forEach((a, i) => {
    actCard.appendChild(
      el(
        "div",
        { class: `nu-ur-row${i === user.activity.length - 1 ? " nu-ur-row--last" : ""}` },
        el("span", { class: "nu-ur-actic" }, icon(a.icon, { size: "0.85rem" })),
        el("span", { class: "nu-ur-acttext" }, a.text),
        el("span", { class: "nu-ur-rowsub" }, a.time),
      ),
    );
  });
  act.appendChild(actCard);
  wrap.appendChild(act);

  /* owned */
  if (user.owned.length) {
    const owned = el("div", {}, secLabel("box-seam", `owned & related · ${user.owned.length}`));
    const grid = el("div", { class: "nu-ur-owned" });
    user.owned.forEach((o) => {
      grid.appendChild(
        el(
          "button",
          { class: "nu-objcard nu-objcard--sm", style: `--nu-obj-accent:${o.accent}`, onclick: () => cfg.onToast("Open", `${o.objType} · ${o.name}`) },
          el("span", { class: "nu-objcard-icon nu-objcard-icon--sm" }, icon(o.icon, { size: "1rem" })),
          el(
            "span",
            { class: "nu-objcard-meta" },
            el("span", { class: "nu-tag", style: `color:${o.accent};border-color:${o.accent}` }, o.objType),
            el("span", { class: "nu-objcard-title" }, o.name),
            el("span", { class: "nu-ur-rowsub" }, o.meta),
          ),
        ),
      );
    });
    owned.appendChild(grid);
    wrap.appendChild(owned);
  }

  /* notes */
  wrap.appendChild(
    el("div", {}, secLabel("sticky", "notes"), el("div", { class: "nu-ur-card" }, el("p", { class: "nu-ur-notes" }, user.notes))),
  );
}

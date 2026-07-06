/* settings.ts — the account & workspace surface, embedded in the Context panel
   (opened expanded; the nacl terminal stays docked — numu is a CLI first).
   Sections stacked in one scroll column: account · appearance (skins + density)
   · workspace · members & roles · apps & permissions · AI agents · plan ·
   notifications · security & sessions · data & privacy · support · danger. */

import { el, icon, badge, button, input, mountSelect } from "amenan-ui";
import type { BadgeTone } from "amenan-ui";

export interface SettingsCfg {
  meId: string;
  /** The live identity's record (HTTP mode, console v2) — CCD.users wins when absent (sim). */
  me?: ConsoleUserRecordData;
  skinId: string;
  mode: "dark" | "light";
  canImpersonate: boolean;
  onSkin(sk: ConsoleSkin): void;
  onToggleMode(): void;
  onOpenProfile(): void;
  onOpenUser(u: ConsoleUserRecordData): void;
  onImpersonate(u: ConsoleUserRecordData): void;
  /** When present, Account gains the Sign out row (HTTP mode only — sim has no session). */
  onLogout?(): void;
  onToast(title: string, msg: string, tone?: string): void;
}

const MEMBER_TONE: Record<string, BadgeTone | undefined> = { active: "ok", invited: "warn", disabled: "danger" };

function toggle(on: boolean, label: string, onChange: (v: boolean) => void): HTMLElement {
  const btn = el("button", { class: `nu-switch${on ? " is-on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label }, el("span", { class: "nu-switch-knob" }));
  btn.addEventListener("click", () => {
    on = !on;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-checked", String(on));
    onChange(on);
  });
  return btn;
}

export function renderSettings(host: Element, cfg: SettingsCfg): void {
  const CCD = window.CONSOLE_DATA;
  const S = CCD.settings;
  const me = CCD.users[cfg.meId] ?? cfg.me ?? CCD.users["USR_jm"];
  if (!me) return;
  const toast = cfg.onToast;

  const wrap = el("div", { class: "nu-set" });
  host.appendChild(wrap);

  function section(glyph: string, label: string, body: HTMLElement, hideHeader = false): void {
    const sec = el("div", { class: "nu-set-section" });
    if (!hideHeader) {
      sec.appendChild(el("div", { class: "nu-set-title" }, icon(glyph, { size: "1.05rem", color: "var(--text-mute)" }), label));
    }
    sec.appendChild(body);
    wrap.appendChild(sec);
  }

  function card(...rows: Array<HTMLElement | null>): HTMLElement {
    return el("div", { class: "nu-set-card" }, ...rows);
  }

  function row(opts: { glyph?: string; label: string; desc?: string; control: HTMLElement; first?: boolean }): HTMLElement {
    return el(
      "div",
      { class: `nu-set-row${opts.first ? " is-first" : ""}` },
      opts.glyph ? icon(opts.glyph, { size: "1rem", color: "var(--text-mute)" }) : null,
      el("span", { class: "nu-set-rowmeta" }, el("span", { class: "nu-set-rowlabel" }, opts.label), opts.desc ? el("span", { class: "nu-set-rowdesc" }, opts.desc) : null),
      opts.control,
    );
  }

  /* ── account ── */
  const accountHead = el(
    "div",
    { class: "nu-set-row is-first" },
    el("span", { class: "nu-ur-avatar", style: `background:${me.accent}` }, el("span", { class: "nu-ur-avatxt" }, me.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2))),
    el("span", { class: "nu-set-rowmeta" }, el("span", { class: "nu-set-acctname" }, me.name), el("span", { class: "nu-set-rowdesc nu-mono" }, `@${me.handle} · ${me.email}`)),
    button({ label: "Open full profile", icon: "bi-person-badge", variant: "accent", size: "sm", onClick: cfg.onOpenProfile }),
  );
  const langSel = el("div", { class: "nu-set-select" });
  mountSelect(langSel, {
    options: S.locales.map((l) => ({ value: l, label: l })),
    value: me.locale,
    onChange: () => toast("Language", "Interface language updated"),
  });
  section(
    "person-circle",
    "Account",
    card(
      accountHead,
      row({ glyph: "key", label: "Password & sign-in", desc: "Change password · manage passkeys", control: button({ label: "Manage", size: "sm", onClick: () => toast("Sign-in", "Manage password & passkeys") }) }),
      row({ glyph: "translate", label: "Language", desc: "Interface language", control: langSel }),
      cfg.onLogout
        ? row({ glyph: "box-arrow-right", label: "Sign out", desc: "Ends every session on every device", control: button({ label: "Sign out", size: "sm", onClick: cfg.onLogout }) })
        : null,
    ),
  );

  /* ── appearance: the skin cards + dark toggle ── */
  const skinGrid = el("div", { class: "nu-set-skins" });
  S.skins.forEach((sk) => {
    const on = cfg.skinId === sk.id;
    skinGrid.appendChild(
      el(
        "button",
        { class: `nu-set-skin${on ? " is-active" : ""}`, onclick: () => cfg.onSkin(sk) },
        el("span", { class: `nu-skin-sw nu-skin-sw--${sk.id}` }, on ? el("span", { class: "nu-set-skincheck" }, icon("check-lg", { size: "0.7rem", color: "var(--accent)" })) : null),
        el(
          "span",
          { class: "nu-set-skinmeta" },
          el("span", { class: "nu-set-skinname" }, sk.name, sk.gradient ? icon("stars", { size: "0.66rem", color: "var(--accent)" }) : null),
          el("span", { class: "nu-set-rowdesc nu-mono" }, sk.desc),
        ),
      ),
    );
  });
  const appearance = el("div", { class: "nu-set-stack" });
  appearance.appendChild(el("div", {}, el("span", { class: "nu-set-fieldlabel" }, "theme"), skinGrid));
  appearance.appendChild(
    card(
      row({
        glyph: cfg.mode === "dark" ? "moon-stars" : "brightness-high",
        label: "Dark mode",
        desc: "Flip light / dark without changing the accent",
        control: toggle(cfg.mode === "dark", "Dark mode", () => cfg.onToggleMode()),
        first: true,
      }),
    ),
  );
  section("palette", "Appearance", appearance);

  /* ── workspace ── */
  const w = S.workspace;
  const wsGrid = el("div", { class: "nu-set-grid2" });
  const wsField = (label: string, control: HTMLElement): HTMLElement =>
    el("label", { class: "nu-set-field" }, el("span", { class: "nu-set-fieldlabel" }, label), control);
  wsGrid.appendChild(wsField("workspace name", input({ value: w.name })));
  wsGrid.appendChild(wsField("handle", input({ value: w.handle })));
  const curSel = el("div", {});
  mountSelect(curSel, { options: S.currencies.map((x) => ({ value: x, label: x })), value: w.currency });
  wsGrid.appendChild(wsField("currency", curSel));
  const locSel = el("div", {});
  mountSelect(locSel, { options: S.locales.map((x) => ({ value: x, label: x })), value: w.locale });
  wsGrid.appendChild(wsField("locale", locSel));
  wsGrid.appendChild(wsField("timezone", input({ value: w.timezone })));
  wsGrid.appendChild(wsField("region", input({ value: w.region })));
  section(
    "building-gear",
    "Workspace",
    card(
      el(
        "div",
        { class: "nu-set-pad" },
        wsGrid,
        el(
          "div",
          { class: "nu-set-saverow" },
          button({ label: "Save changes", icon: "bi-check-lg", variant: "accent", size: "sm", onClick: () => toast("Workspace", `Saved · ${w.name}`) }),
          el("span", { class: "nu-set-rowdesc nu-mono" }, "affects formatting across every view"),
        ),
      ),
    ),
  );

  /* ── members & roles ── */
  const membersCard = el("div", { class: "nu-set-card" });
  CCD.userOrder.forEach((id, i) => {
    const u = CCD.users[id];
    if (!u) return;
    const roleSel = el("div", { class: "nu-set-select" });
    mountSelect(roleSel, {
      options: ["owner", "admin", "member", "viewer"].map((r) => ({ value: r, label: r[0]!.toUpperCase() + r.slice(1) })),
      value: (u.memberships[0]?.role ?? "member") as string,
      onChange: (v) => toast("Role", `${u.name} → ${v}`),
    });
    membersCard.appendChild(
      el(
        "div",
        { class: `nu-set-row${i === 0 ? " is-first" : ""}` },
        el(
          "button",
          { class: "nu-set-member", onclick: () => cfg.onOpenUser(u) },
          el("span", { class: "nu-ur-avatar nu-ur-avatar--sm", style: `background:${u.accent}` }, el("span", { class: "nu-ur-avatxt" }, u.name.split(/\s+/).map((x) => x[0]).join("").slice(0, 2))),
          el(
            "span",
            { class: "nu-set-rowmeta" },
            el("span", { class: "nu-set-rowlabel" }, u.name, u.self ? badge({ label: "you", tone: "accent" }) : null),
            el("span", { class: "nu-set-rowdesc nu-mono" }, `@${u.handle} · ${u.email}`),
          ),
        ),
        badge({ label: u.status, tone: MEMBER_TONE[u.status] }),
        roleSel,
        cfg.canImpersonate && !u.self && u.kind === "human"
          ? button({ icon: "bi-eye", title: "Impersonate", variant: "ghost", size: "sm", onClick: () => cfg.onImpersonate(u) })
          : null,
      ),
    );
  });
  const membersWrap = el("div", { class: "nu-set-stack" });
  membersWrap.appendChild(
    el(
      "div",
      { class: "nu-set-membershead" },
      el("span", { class: "nu-set-rowdesc nu-mono" }, `${CCD.userOrder.length} members · ${S.workspace.name}`),
      el("span", { class: "nu-spring" }),
      button({ label: "Filter", icon: "bi-funnel", size: "sm" }),
      button({ label: "Invite", icon: "bi-person-plus", variant: "accent", size: "sm", onClick: () => toast("Invite", "Send a workspace invitation") }),
    ),
  );
  membersWrap.appendChild(membersCard);
  section("people", "Members & roles", membersWrap);

  /* ── apps & permissions (order + grants) ── */
  const appsWrap = el("div", { class: "nu-set-stack" });
  const installed = CCD.apps.filter((a) => a.installed);
  const orderCard = el("div", { class: "nu-set-card" });
  installed.forEach((a, i) => {
    orderCard.appendChild(
      el(
        "div",
        { class: `nu-set-row${i === 0 ? " is-first" : ""}` },
        icon("grip-vertical", { size: "1rem", color: "var(--text-mute)" }),
        el(
          "span",
          { class: "nu-brand nu-brand--sm" + (a.img ? " nu-brand--img" : "") },
          a.img ? el("img", { src: a.img.replace(/^logos\//, "assets/logos/"), alt: "", class: "nu-brand-img" }) : icon(a.icon ?? "app", { size: "1.05rem", color: a.accent }),
        ),
        el("span", { class: "nu-set-rowmeta" }, el("span", { class: "nu-set-rowlabel" }, a.name), el("span", { class: "nu-set-rowdesc" }, a.cat)),
        el("span", { class: "nu-set-rowdesc nu-mono" }, `#${i + 1}`),
      ),
    );
  });
  appsWrap.appendChild(el("div", {}, el("span", { class: "nu-set-fieldlabel" }, "installed — order in the Objects rail"), orderCard));
  const grantsCard = el("div", { class: "nu-set-card" });
  installed.forEach((a, i) => {
    const scopes = S.appScopes;
    const grants = new Set(scopes.slice(0, 3).map((s) => s.id));
    const detail = el("div", { class: "nu-set-grants", hidden: "hidden" });
    scopes.forEach((s) => {
      detail.appendChild(
        el(
          "div",
          { class: "nu-set-grantrow" },
          el("span", { class: "nu-set-rowmeta" }, el("span", { class: "nu-set-rowlabel" }, s.label), el("span", { class: "nu-set-rowdesc" }, s.desc)),
          toggle(grants.has(s.id), s.label, (v) => (v ? grants.add(s.id) : grants.delete(s.id))),
        ),
      );
    });
    detail.appendChild(
      el(
        "div",
        { class: "nu-set-saverow" },
        button({ label: "View reach", icon: "bi-shield-check", size: "sm", onClick: () => toast("Reach", `${a.name} · scoped to your access`) }),
        button({ label: "Revoke all", icon: "bi-x-circle", size: "sm", onClick: () => toast("App", `Revoked all access for ${a.name}`, "danger") }),
      ),
    );
    const head = el(
      "button",
      { class: `nu-set-apphead${i === 0 ? " is-first" : ""}`, onclick: () => { detail.hidden = !detail.hidden; } },
      el(
        "span",
        { class: "nu-brand nu-brand--sm" + (a.img ? " nu-brand--img" : "") },
        a.img ? el("img", { src: a.img.replace(/^logos\//, "assets/logos/"), alt: "", class: "nu-brand-img" }) : icon(a.icon ?? "app", { size: "1.05rem", color: a.accent }),
      ),
      el("span", { class: "nu-set-rowmeta" }, el("span", { class: "nu-set-rowlabel" }, a.name), el("span", { class: "nu-set-rowdesc" }, `${grants.size} of ${scopes.length} permissions`)),
      icon("chevron-down", { size: "0.8rem", color: "var(--text-mute)" }),
    );
    grantsCard.appendChild(el("div", {}, head, detail));
  });
  appsWrap.appendChild(el("div", {}, el("span", { class: "nu-set-fieldlabel" }, "permissions granted to installed apps"), grantsCard));
  section("grid-3x3-gap", "Apps & permissions", appsWrap);

  /* ── AI agents (bring your own model) ── */
  const aiGrid = el("div", { class: "nu-set-aigrid" });
  S.aiConnect.forEach((a) => {
    let on = a.connected;
    const note = el("div", { class: "nu-set-ainote" }, on && a.plan ? a.plan : a.note);
    const btnHost = el("div", {});
    const renderBtn = (): void => {
      btnHost.textContent = "";
      btnHost.appendChild(
        button({
          label: on ? "Disconnect" : "Connect",
          icon: on ? "bi-x-circle" : "bi-plug",
          variant: on ? undefined : "accent",
          size: "sm",
          onClick: () => {
            on = !on;
            note.textContent = on && a.plan ? a.plan : a.note;
            toast(a.name, on ? "Connect · paste your API key" : "Disconnected", on ? "ok" : "warn");
            renderBtn();
          },
        }),
      );
    };
    renderBtn();
    aiGrid.appendChild(
      el(
        "div",
        { class: "nu-set-aicard" },
        el(
          "div",
          { class: "nu-set-airow" },
          el(
            "span",
            { class: "nu-brand" + (a.img ? "" : "") , style: "width:2.1rem;height:2.1rem" },
            a.img ? el("img", { src: a.img.replace(/^(?!assets\/)/, "assets/"), alt: "", class: "nu-brand-img" }) : icon(a.icon ?? "stars", { size: "1.1rem" }),
          ),
          el("span", { class: "nu-set-rowmeta" }, el("span", { class: "nu-set-rowlabel" }, a.name), el("span", { class: "nu-set-rowdesc nu-mono" }, a.vendor)),
          on ? badge({ label: "connected", tone: "ok" }) : null,
        ),
        note,
        btnHost,
      ),
    );
  });
  const aiWrap = el("div", { class: "nu-set-stack" });
  aiWrap.appendChild(el("p", { class: "nu-set-lede" }, "Bring your own model subscription — numu never resells tokens. Connected models power agents, the composer assistant, and nacl drafting."));
  aiWrap.appendChild(aiGrid);
  section("stars", "AI agents", aiWrap);

  /* ── plan & billing ── */
  const planGrid = el("div", { class: "nu-set-plans" });
  S.plans.forEach((p) => {
    const on = !!p.current;
    planGrid.appendChild(
      el(
        "div",
        { class: `nu-set-plan${on ? " is-current" : ""}` },
        on ? el("span", { class: "nu-set-plancur" }, badge({ label: "current", tone: "accent" })) : null,
        el("div", {}, el("div", { class: "nu-set-planname" }, p.name), el("div", { class: "nu-set-planprice" }, el("span", { class: "nu-set-planamount" }, p.price), el("span", { class: "nu-set-rowdesc nu-mono" }, p.per))),
        el("div", { class: "nu-set-planfeat" }, ...p.features.map((f) => el("div", { class: "nu-set-featrow" }, icon("check2", { size: "0.85rem", color: "var(--ok)" }), f))),
        button({
          label: on ? "Your plan" : p.id === "studio" ? "Contact sales" : p.id === "free" ? "Downgrade" : "Upgrade",
          size: "sm",
          variant: on ? undefined : "accent",
          disabled: on,
          onClick: () => toast("Plan", p.id === "studio" ? "We'll be in touch" : `Switched to ${p.name}`, "ok"),
        }),
      ),
    );
  });
  section("credit-card", "Plan & billing", planGrid);

  /* ── notifications ── */
  const notifCard = el("div", { class: "nu-set-card" });
  S.notifications.forEach((n, i) => {
    notifCard.appendChild(
      row({ glyph: "bell", label: n.label, desc: n.desc, control: toggle(n.on, n.label, () => {}), first: i === 0 }),
    );
  });
  section("bell", "Notifications", notifCard);

  /* ── security & sessions ── */
  const secWrap = el("div", { class: "nu-set-stack" });
  secWrap.appendChild(
    card(
      row({
        glyph: "shield-lock",
        label: "Two-factor authentication",
        desc: "Require a code from your authenticator app",
        control: toggle(true, "Two-factor authentication", (v) => toast("2FA", v ? "Enabled" : "Disabled", v ? "ok" : "warn")),
        first: true,
      }),
    ),
  );
  const sessCard = el("div", { class: "nu-set-card" });
  (me.sessions ?? []).forEach((s, i) => {
    sessCard.appendChild(
      el(
        "div",
        { class: `nu-set-row${i === 0 ? " is-first" : ""}` },
        icon(s.device.includes("iPhone") ? "phone" : "laptop", { size: "1.05rem", color: "var(--text-mute)" }),
        el(
          "span",
          { class: "nu-set-rowmeta" },
          el("span", { class: "nu-set-rowlabel" }, s.device, s.current ? badge({ label: "this device", tone: "ok" }) : null),
          el("span", { class: "nu-set-rowdesc nu-mono" }, `${s.os} · ${s.where} · ${s.ip} · ${s.last}`),
        ),
        s.current ? el("span", {}) : button({ label: "Revoke", size: "sm", onClick: () => toast("Session", `Revoked ${s.device}`, "warn") }),
      ),
    );
  });
  secWrap.appendChild(el("div", {}, el("span", { class: "nu-set-fieldlabel" }, "active sessions"), sessCard));
  secWrap.appendChild(el("div", {}, button({ label: "Sign out everywhere else", icon: "bi-box-arrow-right", size: "sm", onClick: () => toast("Sessions", "Signed out of all other devices", "warn") })));
  section("shield-lock", "Security & sessions", secWrap);

  /* ── data & privacy ── */
  const dataWrap = el("div", { class: "nu-set-stack" });
  dataWrap.appendChild(
    card(
      row({ glyph: "download", label: "Export your data", desc: "Every object you can reach, as JSON + CSV", control: button({ label: "Export", size: "sm", onClick: () => toast("Export", "Preparing your data export…") }), first: true }),
      row({ glyph: "database-fill-lock", label: "On-device storage", desc: "This workspace runs on GlueSQL — data never leaves the page", control: badge({ label: "on device", tone: "ok" }) }),
    ),
  );
  dataWrap.appendChild(el("div", {}, button({ label: "Clear local data", icon: "bi-trash", size: "sm", onClick: () => toast("Local data", "This clears cached data on this device", "danger") })));
  section("database-lock", "Data & privacy", dataWrap);

  /* ── support & feedback ── */
  const fbArea = el("textarea", { class: "nu-set-fbtext", rows: "3", placeholder: "What's working well? What's missing?" });
  let rating = 0;
  const stars = el("div", { class: "nu-set-stars" }, el("span", { class: "nu-set-rowdesc" }, "Rate numu"));
  const starBtns: HTMLElement[] = [];
  for (let n = 1; n <= 5; n++) {
    const b = el("button", { class: "nu-set-star", "aria-label": `${n} stars`, onclick: () => { rating = n; starBtns.forEach((sb, i2) => sb.classList.toggle("is-on", i2 < n)); } }, icon("star-fill", { size: "1.15rem" }));
    starBtns.push(b);
    stars.appendChild(b);
  }
  const supWrap = el("div", { class: "nu-set-stack" });
  supWrap.appendChild(
    card(
      row({ glyph: "life-preserver", label: "Contact support", desc: "Typically replies within a few hours", control: button({ label: "Start a chat", icon: "bi-chat-dots", variant: "accent", size: "sm", onClick: () => toast("Support", "Opening a support thread…") }), first: true }),
      row({ glyph: "book", label: "Docs & nacl reference", desc: "Guides, the object catalog, and the nacl grammar", control: button({ label: "Open", icon: "bi-box-arrow-up-right", size: "sm", onClick: () => toast("Docs", "Opening documentation") }) }),
    ),
  );
  supWrap.appendChild(
    el(
      "div",
      {},
      el("span", { class: "nu-set-fieldlabel" }, "leave feedback"),
      el(
        "div",
        { class: "nu-set-card nu-set-pad nu-set-stack--tight" },
        stars,
        fbArea,
        el("div", {}, button({ label: "Send feedback", icon: "bi-send", variant: "accent", size: "sm", onClick: () => { toast("Feedback", rating ? `Thanks — ${rating}★ sent` : "Thanks for the feedback"); fbArea.value = ""; rating = 0; starBtns.forEach((sb) => sb.classList.remove("is-on")); } })),
      ),
    ),
  );
  section("life-preserver", "Support & feedback", supWrap);

  /* ── danger zone ── */
  section(
    "exclamation-octagon",
    "Danger zone",
    el(
      "div",
      { class: "nu-set-danger" },
      el("span", { class: "nu-set-rowmeta" }, el("span", { class: "nu-set-rowlabel nu-set-dangertext" }, "Delete account"), el("span", { class: "nu-set-rowdesc" }, "Permanently delete your account and personal data")),
      button({ label: "Delete", variant: "danger", size: "sm", onClick: () => toast("Delete account", "This cannot be undone", "danger") }),
    ),
    true,
  );
}

/* context-panel.ts — the right Context panel: mobile-width by default with an
   expand button to full width, swapping to a TYPE-SPECIFIC viewer:
   audio (REAL <audio> playback, persisted position, cover art) · video (REAL
   <video>, custom scrim controls, persisted position, 4 expanded layouts:
   cinema/review/strip/full + up-next tiles) · artist (hero + featured tracks +
   discography) · image gallery · dashboard · storeItem (app/agent detail) ·
   connector config (brand logos) · user (the user-record viewer) · settings ·
   app (iframe) · case/record detail (workflow stepper + people & routing). */

import { el, icon, badge, button, mountCode, mountField, input, renderMarkdown } from "amenan-ui";
import type { BadgeTone } from "amenan-ui";
import { mountNuChart } from "./chart-theme.ts";
import { renderUserRecord } from "./user-record.ts";
import { renderSettings, type SettingsCfg } from "./settings.ts";
import { brandTile } from "./store.ts";

const STATUS_TONE: Record<string, BadgeTone | undefined> = {
  in_review: "warn",
  pending: "warn",
  done: "ok",
  paid: "ok",
  active: "ok",
  refunded: "danger",
};
const PRI_TONE: Record<string, BadgeTone | undefined> = { low: undefined, normal: "info", high: "warn", urgent: "danger" };

type PanelObject =
  | ConsoleObject
  | (ConsoleConnector & { type: "connector" })
  | (ConsoleStoreApp & { type: "storeItem"; storeKind: "App" | "Agent"; on: boolean; onLabel: string })
  | (ConsoleUserRecordData & { self?: boolean })
  | { type: "settings"; name: string; accent: string };

export interface ContextPanelCfg {
  object: PanelObject | null;
  expanded: boolean;
  /** related videos for the up-next strips */
  related: ConsoleObject[];
  canImpersonate: boolean;
  settings: Omit<SettingsCfg, "onToast" | "onOpenUser" | "onImpersonate" | "onOpenProfile"> & SettingsCfg;
  onOpenObject(o: PanelObject): void;
  onImpersonate(u: ConsoleUserRecordData): void;
  /** HTTP mode: persist a self-profile edit (passed to the user-record self view). */
  onSaveProfile?(field: "display_name" | "handle" | "first_name" | "last_name" | "email", value: string): Promise<boolean>;
  onToast(title: string, msg: string, tone?: string): void;
  onExpand(): void;
  onClose(): void;
}

export interface ContextPanelHandle {
  el: HTMLElement;
  update(cfg: ContextPanelCfg): void;
}

function fmtTime(s: number): string {
  return isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";
}

function secLabel(text: string): HTMLElement {
  return el("div", { class: "nu-sec-label" }, text);
}

function fieldRow(k: string, v: string): HTMLElement {
  return el("div", { class: "nu-field-row" }, el("span", { class: "nu-field-k" }, k), el("span", { class: "nu-field-v" }, v));
}

/* ── audio: real playback + persisted position ─────────────────────────── */

function audioViewer(o: ConsoleObject, expanded: boolean, host: HTMLElement): void {
  if (!o.src) {
    host.appendChild(el("div", { class: "nu-viewer-audio" }, el("div", { class: "nu-media nu-media--art" }, icon("music-note-beamed", { size: "3rem" })), el("div", { class: "nu-viewer-title" }, o.name)));
    return;
  }
  const key = "numu_pos_" + o.id;
  const audio = el("audio", { src: encodeURI(o.src), preload: "metadata" });
  const posLbl = el("span", {}, "0:00");
  const durLbl = el("span", {}, o.duration ?? "0:00");
  const fill = el("div", { class: "nu-seek-fill" });
  const track = el("div", { class: "nu-seek" }, fill);
  const playBtn = el("button", { class: "nu-media-bigplay", "aria-label": "Play" }, icon("play-fill", { size: "1.4rem" }));

  const saved = parseFloat(localStorage.getItem(key) ?? "0");
  audio.addEventListener("loadedmetadata", () => {
    durLbl.textContent = fmtTime(audio.duration);
    if (saved > 1) audio.currentTime = saved;
  });
  audio.addEventListener("timeupdate", () => {
    posLbl.textContent = fmtTime(audio.currentTime);
    fill.style.width = audio.duration ? `${(100 * audio.currentTime) / audio.duration}%` : "0";
    try { localStorage.setItem(key, String(audio.currentTime)); } catch { /* quota */ }
  });
  const syncPlay = (): void => {
    playBtn.textContent = "";
    playBtn.appendChild(icon(audio.paused ? "play-fill" : "pause-fill", { size: "1.4rem" }));
  };
  audio.addEventListener("play", syncPlay);
  audio.addEventListener("pause", syncPlay);
  audio.addEventListener("ended", () => { try { localStorage.setItem(key, "0"); } catch { /* quota */ } });
  playBtn.addEventListener("click", () => (audio.paused ? void audio.play().catch(() => {}) : audio.pause()));
  track.addEventListener("click", (ev) => {
    if (!audio.duration) return;
    const r = track.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * audio.duration;
  });
  if (o.autoplay) void audio.play().catch(() => {});

  host.appendChild(
    el(
      "div",
      { class: "nu-viewer-audio" },
      audio,
      o.cover
        ? el("img", { src: encodeURI(o.cover), alt: o.album ?? o.name, class: `nu-cover${expanded ? " is-expanded" : ""}` })
        : el("div", { class: `nu-media nu-media--art${expanded ? " is-expanded" : ""}` }, icon("music-note-beamed", { size: "3rem" })),
      el(
        "div",
        { class: "nu-viewer-titleblock" },
        el("div", { class: "nu-viewer-title" }, o.name),
        el("div", { class: "nu-viewer-sub" }, `${o.artist ?? ""}${o.album ? " · " + o.album : ""}`),
      ),
      el(
        "div",
        { class: "nu-media-controls" },
        el("div", { class: "nu-seek-wrap" }, track, el("div", { class: "nu-seek-times" }, posLbl, durLbl)),
        el(
          "div",
          { class: "nu-media-row" },
          el("button", { class: "nu-media-ctl", "aria-label": "Shuffle" }, icon("shuffle", { size: "1rem" })),
          el("button", { class: "nu-media-ctl", "aria-label": "Previous" }, icon("skip-start-fill", { size: "1.3rem" })),
          playBtn,
          el("button", { class: "nu-media-ctl", "aria-label": "Next" }, icon("skip-end-fill", { size: "1.3rem" })),
          el("button", { class: "nu-media-ctl", "aria-label": "Repeat" }, icon("repeat", { size: "1rem" })),
        ),
      ),
    ),
  );
}

/* ── video: real playback, scrim controls, persisted position, layouts ─── */

function videoStage(o: ConsoleObject, fill: boolean): { stage: HTMLElement; video: HTMLVideoElement } {
  const key = "numu_pos_" + o.id;
  const video = el("video", { src: encodeURI(o.src ?? ""), preload: "metadata", class: "nu-video-el" });
  const bigPlay = el("button", { class: "nu-video-bigplay", "aria-label": "Play" }, icon("play-fill", { size: "1.6rem" }));
  const posLbl = el("span", { class: "nu-video-time" }, "0:00 ");
  const durLbl = el("span", { class: "nu-video-time nu-video-time--dim" }, `/ ${o.duration ?? "0:00"}`);
  const seekFill = el("div", { class: "nu-video-seekfill" });
  const seekKnob = el("div", { class: "nu-video-knob" });
  const seek = el("div", { class: "nu-video-seek" }, seekFill, seekKnob);
  const volFill = el("div", { class: "nu-video-volfill" });
  const vol = el("div", { class: "nu-video-vol" }, volFill);

  const ctl = (glyph: string, label: string, on: () => void, big = false): HTMLElement => {
    const b = el("button", { class: `nu-video-ctl${big ? " nu-video-ctl--big" : ""}`, "aria-label": label, title: label, onclick: on }, icon(glyph, { size: big ? "1.2rem" : "1.05rem" }));
    return b;
  };

  const toggle = (): void => (video.paused ? void video.play().catch(() => {}) : video.pause());
  const playPause = ctl("play-fill", "Play", toggle, true);
  const muteBtn = ctl("volume-up-fill", "Mute", () => { video.muted = !video.muted; });

  const saved = parseFloat(localStorage.getItem(key) ?? "0");
  video.addEventListener("loadedmetadata", () => {
    durLbl.textContent = `/ ${fmtTime(video.duration)}`;
    if (saved > 1) video.currentTime = saved;
  });
  video.addEventListener("timeupdate", () => {
    posLbl.textContent = fmtTime(video.currentTime) + " ";
    const pct = video.duration ? (100 * video.currentTime) / video.duration : 0;
    seekFill.style.width = `${pct}%`;
    seekKnob.style.left = `${pct}%`;
    try { localStorage.setItem(key, String(video.currentTime)); } catch { /* quota */ }
  });
  const syncPlay = (): void => {
    bigPlay.hidden = !video.paused;
    playPause.textContent = "";
    playPause.appendChild(icon(video.paused ? "play-fill" : "pause-fill", { size: "1.2rem" }));
  };
  video.addEventListener("play", syncPlay);
  video.addEventListener("pause", syncPlay);
  video.addEventListener("ended", () => { try { localStorage.setItem(key, "0"); } catch { /* quota */ } });
  video.addEventListener("volumechange", () => {
    volFill.style.width = `${video.muted ? 0 : video.volume * 100}%`;
    muteBtn.textContent = "";
    muteBtn.appendChild(icon(video.muted || video.volume === 0 ? "volume-mute-fill" : video.volume < 0.5 ? "volume-down-fill" : "volume-up-fill", { size: "1.05rem" }));
  });
  video.addEventListener("click", toggle);
  bigPlay.addEventListener("click", toggle);
  seek.addEventListener("click", (ev) => {
    if (!video.duration) return;
    const r = seek.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * video.duration;
  });
  vol.addEventListener("click", (ev) => {
    const r = vol.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    video.volume = v;
    video.muted = v === 0;
  });
  if (o.autoplay) void video.play().catch(() => {});

  const stage = el(
    "div",
    { class: `nu-video-stage${fill ? " is-fill" : ""}` },
    video,
    bigPlay,
    el(
      "div",
      { class: "nu-video-scrim" },
      seek,
      el(
        "div",
        { class: "nu-video-bar" },
        playPause,
        ctl("skip-backward-fill", "Back 10s", () => { video.currentTime = Math.max(0, video.currentTime - 10); }),
        ctl("skip-forward-fill", "Forward 10s", () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); }),
        posLbl,
        durLbl,
        el("span", { class: "nu-spring" }),
        muteBtn,
        vol,
        ctl("arrows-fullscreen", "Fullscreen", () => void video.requestFullscreen?.().catch(() => {})),
      ),
    ),
  );
  return { stage, video };
}

type VideoLayout = "cinema" | "review" | "strip" | "full";

function videoViewer(
  o: ConsoleObject,
  expanded: boolean,
  related: ConsoleObject[],
  layout: VideoLayout,
  onLayout: (l: VideoLayout) => void,
  onOpen: (v: PanelObject) => void,
  host: HTMLElement,
): void {
  const others = related.filter((v) => v.id !== o.id && v.src);
  const title = el(
    "div",
    { class: "nu-viewer-titleblock" },
    el("span", { class: "nu-viewer-title" }, o.name),
    el("span", { class: "nu-viewer-sub" }, o.meta ?? ""),
  );
  const seg = (l: VideoLayout): HTMLElement =>
    el("button", { class: `nu-video-seg${layout === l ? " is-active" : ""}`, onclick: () => onLayout(l) }, l);
  const tile = (v: ConsoleObject, wide: boolean): HTMLElement =>
    el(
      "button",
      { class: `nu-video-tile${wide ? " is-wide" : ""}`, title: v.name, onclick: () => onOpen({ ...v, autoplay: true }) },
      el("span", { class: "nu-video-thumb", style: `color:${v.accent}` }, icon("play-fill", { size: "1rem" })),
      el("span", { class: "nu-video-tilemeta" }, el("span", { class: "nu-video-tilename" }, v.name), el("span", { class: "nu-video-tilesub" }, v.meta ?? "")),
    );

  if (!expanded) {
    const { stage } = videoStage(o, false);
    host.appendChild(el("div", { class: "nu-viewer-stack" }, stage, title));
    return;
  }
  if (layout === "full") {
    const { stage } = videoStage(o, true);
    host.appendChild(
      el(
        "div",
        { class: "nu-video-full" },
        el(
          "div",
          { class: "nu-video-fullwrap" },
          stage,
          el("div", { class: "nu-video-fulltitle" }, o.name),
          el("div", { class: "nu-video-fullsegs" }, seg("cinema"), seg("review"), seg("strip"), seg("full")),
        ),
      ),
    );
    return;
  }
  const switcher = el("div", { class: "nu-video-switch" }, secLabel("layout"), el("span", { class: "nu-spring" }), seg("cinema"), seg("review"), seg("strip"), seg("full"));
  const { stage } = videoStage(o, false);
  if (layout === "review") {
    host.appendChild(switcher);
    host.appendChild(
      el(
        "div",
        { class: "nu-video-review" },
        el("div", {}, stage),
        el(
          "div",
          { class: "nu-viewer-stack nu-viewer-stack--tight" },
          title,
          fieldRow("kind", "social video"),
          fieldRow("shot at", "ORVCLE · Studio A"),
          others.length ? el("div", {}, secLabel("up next"), el("div", { class: "nu-video-upnext" }, ...others.map((v) => tile(v, true)))) : null,
        ),
      ),
    );
    return;
  }
  if (layout === "strip") {
    host.appendChild(switcher);
    host.appendChild(
      el(
        "div",
        { class: "nu-video-center nu-video-center--strip" },
        stage,
        title,
        others.length ? el("div", { class: "nu-video-strip" }, ...others.map((v) => tile(v, false))) : null,
      ),
    );
    return;
  }
  host.appendChild(switcher);
  host.appendChild(el("div", { class: "nu-video-center" }, stage, title));
}

/* ── artist: hero + featured tracks + discography ──────────────────────── */

function artistViewer(o: ConsoleObject, expanded: boolean, onOpen: (v: PanelObject) => void, host: HTMLElement): void {
  const tracks = o.tracks ?? [];
  const hero = el(
    "div",
    { class: "nu-artist-hero" },
    o.cover
      ? el("img", { src: encodeURI(o.cover), alt: o.name, class: `nu-artist-cover${expanded ? " is-expanded" : ""}` })
      : el("div", { class: `nu-artist-ini${expanded ? " is-expanded" : ""}`, style: `color:${o.accent}` }, o.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()),
    el(
      "div",
      { class: "nu-artist-meta" },
      el("div", { class: "nu-artist-name" }, o.name),
      el("div", { class: "nu-viewer-sub" }, o.meta ?? ""),
      el("span", { class: "nu-spring" }),
      el(
        "div",
        { class: "nu-artist-stats" },
        el("span", { class: "nu-artist-stat" }, el("span", { class: "nu-artist-statv" }, o.plays ?? "—"), secLabel("plays")),
        el("span", { class: "nu-artist-stat" }, el("span", { class: "nu-artist-statv" }, String(tracks.length)), secLabel("tracks")),
      ),
    ),
  );
  host.appendChild(hero);

  if (tracks.length) {
    const list = el("div", { class: "nu-artist-tracks" });
    tracks.forEach((t, i) => {
      list.appendChild(
        el(
          "button",
          { class: "nu-artist-track", onclick: () => onOpen({ ...t, autoplay: true }) },
          t.cover ? el("img", { src: encodeURI(t.cover), alt: "", class: "nu-artist-trackcover" }) : icon("music-note-beamed", { size: "1rem" }),
          el("span", { class: "nu-artist-trackno" }, `${i + 1}.`),
          el("span", { class: "nu-artist-trackname" }, t.name),
          icon("play-circle", { size: "1.05rem", color: "var(--accent)" }),
          el("span", { class: "nu-artist-trackdur" }, t.duration ?? ""),
        ),
      );
    });
    host.appendChild(el("div", {}, secLabel("featured"), list));
  }

  const albums = o.albums ?? [];
  if (albums.length) {
    const grid = el("div", { class: "nu-artist-albums" });
    albums.forEach((al) => {
      grid.appendChild(
        el(
          "span",
          { class: "nu-artist-album" },
          al.cover
            ? el("img", { src: encodeURI(al.cover), alt: al.title, class: "nu-artist-albumcover" })
            : el("span", { class: "nu-artist-albumph" }, icon("vinyl", { size: "1.6rem" })),
          el("span", { class: "nu-artist-albumtitle" }, al.title),
          el("span", { class: "nu-artist-albumyear" }, `${al.year ?? ""} · album`),
        ),
      );
    });
    host.appendChild(el("div", {}, secLabel("discography"), grid));
  }
}

/* ── storeItem: app/agent detail ───────────────────────────────────────── */

function storeItemViewer(
  o: ConsoleStoreApp & { type: "storeItem"; storeKind: "App" | "Agent"; on: boolean; onLabel: string },
  onOpen: (v: PanelObject) => void,
  host: HTMLElement,
): void {
  host.appendChild(
    el(
      "div",
      { class: "nu-conn-head" },
      brandTile(o, "2.8rem"),
      el(
        "span",
        { class: "nu-conn-id" },
        el(
          "span",
          { class: "nu-conn-name" },
          o.name,
          o.claude ? el("img", { src: "assets/claude-mark.png", alt: "Claude", title: "Claude-powered", class: "nu-claude-mark" }) : null,
        ),
        el("span", { class: "nu-conn-kind" }, `${o.storeKind} · ${o.cat}`),
      ),
      el("span", { class: "nu-spring" }),
      badge({ label: o.on ? o.onLabel : "available", tone: o.on ? "ok" : undefined }),
    ),
  );
  host.appendChild(el("p", { class: "nu-store-tagline nu-store-tagline--panel" }, o.tagline));
  if (o.about?.length) {
    host.appendChild(el("div", {}, secLabel("what it does"), el("ul", { class: "nu-store-about" }, ...o.about.map((a) => el("li", {}, a)))));
  }
  host.appendChild(
    el(
      "div",
      { class: "nu-viewer-actions" },
      o.src
        ? button({ label: "Open app", icon: "bi-box-arrow-up-right", variant: "accent", size: "sm", onClick: () => onOpen({ id: o.id, type: "app", name: o.name, src: o.src, icon: o.icon ?? "app", accent: o.accent }) })
        : button({ label: o.storeKind === "Agent" ? "Configure" : "Install", icon: o.storeKind === "Agent" ? "bi-sliders" : "bi-download", variant: "accent", size: "sm" }),
      o.badge ? badge({ label: o.badge }) : null,
    ),
  );
}

/* ── connector config ──────────────────────────────────────────────────── */

function connectorViewer(o: ConsoleConnector & { type: "connector" }, expanded: boolean, host: HTMLElement): void {
  const isDb = o.kind === "Database" || o.kind === "On-device";
  host.appendChild(
    el(
      "div",
      { class: "nu-conn-head" },
      brandTile(o, "2.4rem"),
      el("span", { class: "nu-conn-id" }, el("span", { class: "nu-conn-name" }, o.name), el("span", { class: "nu-conn-kind" }, o.kind)),
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
    fields.forEach(([label, value]) => mountField(grid, { label, control: input({ value }) }));
    host.appendChild(el("div", {}, secLabel("connection"), grid));
    const cs = el("div", {}, secLabel("connection string"));
    mountCode(cs, {
      text: o.host
        ? `postgresql://${o.user}:••••@${o.host}:${o.port}/${o.database}?sslmode=${o.ssl}`
        : "gluesql://browser · IndexedDB — data never leaves the page",
      block: true,
    });
    host.appendChild(cs);
    host.appendChild(
      el("div", { class: "nu-viewer-actions" }, button({ label: "Test connection", icon: "bi-plug", variant: "accent", size: "sm" }), button({ label: "Disconnect", size: "sm" })),
    );
  } else {
    const acct = el("div", {}, secLabel("account"));
    acct.appendChild(fieldRow("account", o.account ?? "studio@orvcle.io"));
    acct.appendChild(fieldRow("scopes", o.scopes ?? "read · sync"));
    acct.appendChild(fieldRow("last sync", o.lastSync ?? "just now"));
    host.appendChild(acct);
    host.appendChild(
      el("div", { class: "nu-viewer-actions" }, button({ label: "Reconnect", icon: "bi-arrow-repeat", variant: "accent", size: "sm" }), button({ label: "Disconnect", size: "sm" })),
    );
  }
}

/* ── image gallery ─────────────────────────────────────────────────────── */

function imageViewer(o: ConsoleObject, expanded: boolean, host: HTMLElement): void {
  const n = o.gallery ?? 5;
  const thumbs = el("div", { class: "nu-thumbs" });
  for (let i = 0; i < n; i++) {
    thumbs.appendChild(el("span", { class: `nu-thumb${i === 0 ? " is-active" : ""}` }, icon("image", { size: "1rem" })));
  }
  host.appendChild(el("div", { class: `nu-media nu-media--hero${expanded ? " is-expanded" : ""}` }, icon("image", { size: "2.4rem" })));
  host.appendChild(
    el("div", { class: "nu-viewer-titleblock" }, el("div", { class: "nu-viewer-title nu-viewer-title--xl" }, o.name), el("div", { class: "nu-viewer-sub" }, o.meta ?? "")),
  );
  host.appendChild(el("div", {}, secLabel(`${n} photos`), thumbs));
}

/* ── dashboard tiles ───────────────────────────────────────────────────── */

function dashboardViewer(o: ConsoleObject, expanded: boolean, host: HTMLElement): void {
  const grid = el("div", { class: `nu-viewer-dash${expanded ? " is-expanded" : ""}` });
  (o.charts ?? []).forEach((ch) => {
    const tile = el("div", { class: "nu-dash-tile nu-dash-tile--panel" }, el("span", { class: "nu-dash-nacl" }, ch.nacl));
    const slot = el("div", { class: `nu-dash-chart${expanded ? " is-tall" : ""}` });
    tile.appendChild(slot);
    mountNuChart(slot, ch);
    grid.appendChild(tile);
  });
  host.appendChild(grid);
}

/* ── case / record detail ──────────────────────────────────────────────── */

function detailViewer(o: ConsoleObject, host: HTMLElement): void {
  const states = o.wfStates?.length ? o.wfStates : ["backlog", "in_progress", "in_review", "done"];
  const isCase = o.type === "case";
  const idx = states.indexOf(o.status ?? "");

  const idRow = el("div", { class: "nu-detail-idrow" });
  if (o.code) mountCode(idRow, { text: o.code });
  if (o.status) idRow.appendChild(badge({ label: o.status, tone: STATUS_TONE[o.status] }));
  if (isCase && o.caseType) idRow.appendChild(badge({ label: o.caseType }));
  if (isCase && o.priority) idRow.appendChild(badge({ label: `${o.priority} priority`, tone: PRI_TONE[o.priority] }));
  if (isCase && o.classification) idRow.appendChild(badge({ label: o.classification, tone: o.classification === "external" ? "warn" : "info" }));
  host.appendChild(idRow);
  host.appendChild(el("div", { class: "nu-viewer-title nu-viewer-title--xl" }, o.name));
  if (isCase && o.description) host.appendChild(el("div", { class: "nu-detail-desc" }, o.description));

  if (isCase) {
    const stepper = el("div", { class: "nu-stepper" });
    states.forEach((s, i) => {
      const st = i < idx ? "done" : i === idx ? "current" : "todo";
      stepper.appendChild(el("span", { class: `nu-step nu-step--${st}` }, st === "done" ? icon("check", { size: "0.72rem" }) : null, s));
      if (i < states.length - 1) stepper.appendChild(el("span", { class: "nu-step-link" }));
    });
    host.appendChild(el("div", {}, secLabel("workflow"), stepper));

    const people = el("div", {}, secLabel("people & routing"));
    people.appendChild(fieldRow("owner", o.assignee ?? "unassigned"));
    people.appendChild(fieldRow("reporter", o.reporter ?? "—"));
    people.appendChild(fieldRow("project", o.project ?? "—"));
    people.appendChild(fieldRow("origin", o.origin ?? "—"));
    host.appendChild(people);
  }

  const fields = el("div", {}, secLabel("fields"));
  (o.fields ?? []).forEach(([k, v]) => fields.appendChild(fieldRow(k, v)));
  host.appendChild(fields);

  /* a markdown body (article/copy content) renders as prose, not a raw field */
  if (o.bodyMd) {
    const content = el("div", {}, secLabel("content"));
    content.appendChild(el("div", { class: "nu-detail-body amu-md" }, renderMarkdown(o.bodyMd)));
    host.appendChild(content);
  }

  host.appendChild(
    el(
      "div",
      { class: "nu-viewer-actions" },
      button({ icon: "bi-pencil", title: "Edit" }),
      button({ icon: "bi-box-arrow-up-right", title: "Open" }),
      button({ icon: "bi-three-dots", title: "More", variant: "ghost" }),
    ),
  );
}

/* ── the panel shell ───────────────────────────────────────────────────── */

export function mountContextPanel(host: Element, cfg: ContextPanelCfg): ContextPanelHandle {
  const root = el("aside", { class: "nu-context", hidden: "hidden" });
  host.appendChild(root);
  let videoLayout: VideoLayout = ((): VideoLayout => {
    try {
      const v = localStorage.getItem("numu_video_layout");
      return v === "review" || v === "strip" || v === "full" ? v : "cinema";
    } catch {
      return "cinema";
    }
  })();
  let current = cfg;

  function render(c: ContextPanelCfg): void {
    current = c;
    root.textContent = "";
    if (!c.object) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.classList.toggle("is-expanded", c.expanded);
    const o = c.object;
    const accent = "accent" in o && o.accent ? o.accent : "color" in o && o.color ? o.color : "var(--accent)";

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

    const fullVideo = c.expanded && o.type === "video" && "src" in o && o.src && videoLayout === "full";
    const isSettings = o.type === "settings";
    const body = el("div", {
      class: `nu-context-body${c.expanded ? " is-expanded" : ""}${fullVideo ? " is-fullvideo" : ""}${isSettings ? " is-settings" : ""}`,
    });
    root.appendChild(body);

    switch (o.type) {
      case "preview": {
        const node = (o as ConsoleObject).node;
        if (node) body.appendChild(node);
        break;
      }
      case "settings":
        renderSettings(body, c.settings);
        break;
      case "user":
        renderUserRecord(body, {
          user: o as ConsoleUserRecordData,
          editable: !!(o as { self?: boolean }).self,
          canImpersonate: c.canImpersonate,
          onImpersonate: c.onImpersonate,
          onSave: (o as { self?: boolean }).self ? c.onSaveProfile : undefined,
          onToast: c.onToast,
        });
        break;
      case "app":
        body.appendChild(
          el("iframe", { src: (o as ConsoleObject).src ?? "", title: o.name, class: `nu-viewer-app${c.expanded ? " is-expanded" : ""}` }),
        );
        break;
      case "dashboard":
        dashboardViewer(o as ConsoleObject, c.expanded, body);
        break;
      case "storeItem":
        storeItemViewer(o as ConsoleStoreApp & { type: "storeItem"; storeKind: "App" | "Agent"; on: boolean; onLabel: string }, c.onOpenObject, body);
        break;
      case "connector":
        connectorViewer(o as ConsoleConnector & { type: "connector" }, c.expanded, body);
        break;
      case "video":
        videoViewer(
          o as ConsoleObject,
          c.expanded,
          c.related,
          videoLayout,
          (l) => {
            videoLayout = l;
            try { localStorage.setItem("numu_video_layout", l); } catch { /* quota */ }
            render(current);
          },
          c.onOpenObject,
          body,
        );
        break;
      case "artist":
        artistViewer(o as ConsoleObject, c.expanded, c.onOpenObject, body);
        break;
      case "audio":
        audioViewer(o as ConsoleObject, c.expanded, body);
        break;
      case "image":
        imageViewer(o as ConsoleObject, c.expanded, body);
        break;
      default:
        detailViewer(o as ConsoleObject, body);
    }
  }

  render(cfg);
  return { el: root, update: render };
}

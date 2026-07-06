/* apps/portfolio.ts — the Portfolio manager (console v2, CAS_357473a7): the
   app that RUNS em.numu.im from the console. Articles · Overview · CV ·
   Insights over the generic object surface (+If-Match concurrency), with the
   PUBLISH button driving POST /api/apps/portfolio/publish → numu commits
   site.json + the genpdf CV to the portfolio repo → its CI deploys. HTTP mode
   only; registered when the boot probe admits (about 200 + insights ≠ 404). */

import { el, icon, badge, button, input, mountTabs, renderMarkdown } from "amenan-ui";
import { ncl } from "../client.ts";
import { onAppChange } from "../shell/apps.ts";

interface Ent {
  id: string;
  data: Record<string, unknown>;
  version: number;
  etag: string;
}

export interface PortfolioCfg {
  onToast(title: string, msg: string, tone?: string): void;
}

const OVERVIEW_KEYS = ["overview.lead", "overview.body", "overview.muted"];
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number => (typeof v === "number" ? v : 0);

async function list(type: string): Promise<Ent[]> {
  const res = await ncl.request("GET", `/api/objects/${type}?limit=200`);
  if (res.status !== 200) throw new Error(`${type}: ${res.status}`);
  return ((res.body as { items?: Ent[] } | null)?.items ?? []) as Ent[];
}

export function mountPortfolio(host: Element, cfg: PortfolioCfg): { el: HTMLElement } {
  const root = el("div", { class: "nu-pf" });
  host.appendChild(root);
  const toast = cfg.onToast;
  let tab = "articles";

  /* ── header: title · publish ── */
  const pubOut = el("div", { class: "nu-pf-pubout", hidden: "hidden" });
  const publishBtn = button({
    label: "Publish",
    icon: "bi-rocket-takeoff",
    variant: "accent",
    size: "sm",
    onClick: () => void publish(),
  });
  async function publish(): Promise<void> {
    pubOut.hidden = false;
    pubOut.textContent = "publishing…";
    const res = await ncl.request("POST", "/api/apps/portfolio/publish");
    const body = res.body as { version?: string; committed?: string[]; skipped?: string[]; detail?: string } | null;
    pubOut.textContent = "";
    if (res.status === 200 && body) {
      const files = (body.committed ?? []).length;
      pubOut.appendChild(icon("check-circle-fill", { color: "var(--ok)" }));
      pubOut.appendChild(
        el("span", {}, ` v${body.version} · ${files ? `${files} file(s) committed — the portfolio CI is deploying` : "unchanged — nothing to commit"} · `),
      );
      pubOut.appendChild(el("a", { class: "nu-pf-link", href: "https://em.numu.im", target: "_blank", rel: "noreferrer" }, "em.numu.im"));
      toast("Publish", body.version ? `version ${body.version}` : "done", "ok");
    } else {
      pubOut.appendChild(icon("x-circle-fill", { color: "var(--danger)" }));
      pubOut.appendChild(el("span", {}, ` ${body?.detail ?? `publish failed (${res.status})`}`));
      toast("Publish", body?.detail ?? "failed", "danger");
    }
  }

  const tabsHost = el("div", { class: "nu-pf-tabs" });
  const bodyHost = el("div", { class: "nu-pf-body nu-scroll" });
  root.appendChild(
    el(
      "div",
      { class: "nu-pf-head" },
      el("div", {}, el("h2", { class: "nu-pf-h" }, "Portfolio"), el("p", { class: "nu-pf-sub" }, "em.numu.im — content lives here as objects; Publish renders site.json + the CV PDF and commits them.")),
      el("div", { class: "nu-pf-headact" }, publishBtn),
    ),
  );
  root.appendChild(pubOut);
  root.appendChild(tabsHost);
  root.appendChild(bodyHost);

  mountTabs(tabsHost, {
    items: [
      { id: "articles", label: "Articles" },
      { id: "overview", label: "Overview" },
      { id: "cv", label: "CV" },
      { id: "insights", label: "Insights" },
    ],
    defaultValue: tab,
    onChange(v: string) {
      tab = v;
      void render();
    },
  });

  const fail = (e: unknown): void => {
    bodyHost.textContent = "";
    bodyHost.appendChild(el("div", { class: "nu-pf-err" }, `could not load — ${String(e instanceof Error ? e.message : e)}`));
  };

  /* ── a labelled field row ── */
  function field(label: string, control: HTMLElement): HTMLElement {
    return el("label", { class: "nu-pf-field" }, el("span", { class: "nu-pf-flabel" }, label), control);
  }

  /* ── Articles ─────────────────────────────────────────────────────────── */
  async function renderArticles(): Promise<void> {
    const items = (await list("article")).sort((a, b) => n(a.data["ordinal"]) - n(b.data["ordinal"]));
    bodyHost.textContent = "";
    const listCol = el("div", { class: "nu-pf-list" });
    listCol.appendChild(
      el(
        "div",
        { class: "nu-pf-listhead" },
        el("span", {}, `${items.length} articles`),
        button({ label: "New", icon: "bi-plus-lg", size: "sm", onClick: () => editor(null) }),
      ),
    );
    items.forEach((it) => {
      listCol.appendChild(
        el(
          "button",
          { class: "nu-pf-row", onclick: () => editor(it) },
          el("span", { class: "nu-pf-roword" }, String(n(it.data["ordinal"]))),
          el("span", { class: "nu-pf-rowmeta" }, el("span", { class: "nu-pf-rowlabel" }, s(it.data["label"]) || it.id), el("span", { class: "nu-pf-rowsub" }, `${s(it.data["slug"])} · ${s(it.data["tag"])}`)),
          it.data["published"] === true ? badge({ label: "published", tone: "ok" }) : badge({ label: "draft" }),
          icon("chevron-right"),
        ),
      );
    });
    bodyHost.appendChild(listCol);

    function editor(item: Ent | null): void {
      bodyHost.textContent = "";
      const d = item?.data ?? {};
      const labelIn = input({ placeholder: "Title", value: s(d["label"]) });
      /* slug is CREATE-ONLY (editable:false in the registry — it is the
         article's public identity); rendered read-only on existing rows */
      const slugIn = input({ placeholder: "slug-like-this", value: s(d["slug"]) });
      if (item) slugIn.setAttribute("disabled", "disabled");
      const tagIn = input({ placeholder: "TAG", value: s(d["tag"]) });
      const ordIn = input({ placeholder: "ordinal", value: item ? String(n(d["ordinal"])) : "" });
      let published = d["published"] === true;
      const pubToggle = button({
        label: published ? "Published" : "Draft",
        size: "sm",
        variant: published ? "accent" : "ghost",
        onClick: () => {
          published = !published;
          rerenderToggle();
        },
      });
      const toggleHost = el("span", {}, pubToggle);
      function rerenderToggle(): void {
        toggleHost.textContent = "";
        toggleHost.appendChild(
          button({
            label: published ? "Published" : "Draft",
            size: "sm",
            variant: published ? "accent" : "ghost",
            onClick: () => {
              published = !published;
              rerenderToggle();
            },
          }),
        );
      }
      const md = el("textarea", { class: "nu-pf-md", rows: "18", placeholder: "# markdown…" }) as HTMLTextAreaElement;
      md.value = s(d["md"]);
      const preview = el("div", { class: "nu-pf-preview", hidden: "hidden" });
      const previewBtn = button({
        label: "Preview",
        size: "sm",
        variant: "ghost",
        onClick: () => {
          preview.hidden = !preview.hidden;
          if (!preview.hidden) {
            preview.textContent = "";
            preview.appendChild(renderMarkdown(md.value));
          }
        },
      });

      async function save(): Promise<void> {
        const body: Record<string, unknown> = {
          label: labelIn.value,
          tag: tagIn.value,
          ordinal: parseInt(ordIn.value, 10) || 0,
          published,
          md: md.value,
        };
        if (!item) body["slug"] = slugIn.value;
        const res = item
          ? await ncl.request("PATCH", `/api/objects/article/${item.id}`, { body, headers: { "If-Match": item.etag } })
          : await ncl.request("POST", "/api/objects/article", { body });
        if (res.status === 200 || res.status === 201) {
          toast("Article", item ? "saved" : "created", "ok");
          void renderArticles();
        } else if (res.status === 412) {
          toast("Article", "changed elsewhere — reopen it to get the latest", "warn");
        } else {
          toast("Article", (res.body as { detail?: string } | null)?.detail ?? `save failed (${res.status})`, "danger");
        }
      }
      async function del(): Promise<void> {
        if (!item || !window.confirm(`Delete “${s(item.data["label"]) || item.id}”?`)) return;
        const res = await ncl.request("DELETE", `/api/objects/article/${item.id}`, { headers: { "If-Match": item.etag } });
        if (res.status === 204) {
          toast("Article", "deleted", "ok");
          void renderArticles();
        } else toast("Article", `delete failed (${res.status})`, "danger");
      }

      bodyHost.appendChild(
        el(
          "div",
          { class: "nu-pf-editor" },
          el(
            "div",
            { class: "nu-pf-edhead" },
            button({ label: "Back", icon: "bi-arrow-left", size: "sm", variant: "ghost", onClick: () => void renderArticles() }),
            el("span", { class: "nu-spring" }),
            previewBtn,
            item ? button({ label: "Delete", icon: "bi-trash3", size: "sm", variant: "ghost", onClick: () => void del() }) : el("span", { hidden: "hidden" }),
            button({ label: item ? "Save" : "Create", variant: "accent", size: "sm", onClick: () => void save() }),
          ),
          el("div", { class: "nu-pf-grid" }, field("Title", labelIn), field("Slug", slugIn), field("Tag", tagIn), field("Ordinal", ordIn), field("State", toggleHost)),
          md,
          preview,
        ),
      );
    }
  }

  /* ── Overview (the 3 site_copy keys) ──────────────────────────────────── */
  async function renderOverview(): Promise<void> {
    const items = await list("site_copy");
    bodyHost.textContent = "";
    const col = el("div", { class: "nu-pf-editor" });
    OVERVIEW_KEYS.forEach((key) => {
      const item = items.find((x) => s(x.data["key"]) === key) ?? null;
      const ta = el("textarea", { class: "nu-pf-md", rows: "4" }) as HTMLTextAreaElement;
      ta.value = item ? s(item.data["md"]) : "";
      col.appendChild(
        el(
          "div",
          { class: "nu-pf-copyblock" },
          el(
            "div",
            { class: "nu-pf-edhead" },
            el("span", { class: "nu-pf-flabel nu-mono" }, key),
            el("span", { class: "nu-spring" }),
            button({
              label: item ? "Save" : "Create",
              size: "sm",
              variant: "accent",
              onClick: () =>
                void (async () => {
                  const res = item
                    ? await ncl.request("PATCH", `/api/objects/site_copy/${item.id}`, { body: { md: ta.value }, headers: { "If-Match": item.etag } })
                    : await ncl.request("POST", "/api/objects/site_copy", { body: { key, md: ta.value } });
                  if (res.status === 200 || res.status === 201) {
                    toast("Overview", `${key} saved`, "ok");
                    void renderOverview();
                  } else toast("Overview", `${key}: ${res.status}`, "danger");
                })(),
            }),
          ),
          ta,
        ),
      );
    });
    bodyHost.appendChild(col);
  }

  /* ── CV (v1: the validated JSON document — the genpdf contract) ───────── */
  async function renderCv(): Promise<void> {
    const items = await list("cv");
    bodyHost.textContent = "";
    const item = items[0] ?? null;
    const ta = el("textarea", { class: "nu-pf-md nu-mono", rows: "24" }) as HTMLTextAreaElement;
    ta.value = item ? JSON.stringify(item.data["doc"] ?? {}, null, 2) : "";
    const note = el("p", { class: "nu-pf-sub" }, item ? `${item.id} — the JSON document genpdf renders (a structured editor is a recorded follow-on).` : "no cv document yet — paste the doc JSON and Create.");
    bodyHost.appendChild(
      el(
        "div",
        { class: "nu-pf-editor" },
        el(
          "div",
          { class: "nu-pf-edhead" },
          note,
          el("span", { class: "nu-spring" }),
          button({
            label: item ? "Save" : "Create",
            variant: "accent",
            size: "sm",
            onClick: () =>
              void (async () => {
                let doc: unknown;
                try {
                  doc = JSON.parse(ta.value);
                } catch (e) {
                  toast("CV", `not valid JSON — ${String(e)}`, "danger");
                  return;
                }
                const res = item
                  ? await ncl.request("PATCH", `/api/objects/cv/${item.id}`, { body: { doc }, headers: { "If-Match": item.etag } })
                  : await ncl.request("POST", "/api/objects/cv", { body: { name: "CV", doc } });
                if (res.status === 200 || res.status === 201) {
                  toast("CV", "saved — Publish renders the PDF", "ok");
                  void renderCv();
                } else toast("CV", `save failed (${res.status})`, "danger");
              })(),
          }),
        ),
        ta,
      ),
    );
  }

  /* ── Insights ─────────────────────────────────────────────────────────── */
  async function renderInsights(): Promise<void> {
    const res = await ncl.request("GET", "/api/apps/portfolio/insights");
    if (res.status !== 200) throw new Error(`insights: ${res.status}`);
    const d = res.body as Record<string, unknown>;
    bodyHost.textContent = "";
    const wrap = el("div", { class: "nu-pf-insights" });

    type Pair = { key: string; count: number };
    const table = (title: string, rows: Pair[]): HTMLElement => {
      const t = el("div", { class: "nu-pf-itable" }, el("div", { class: "nu-pf-ititle" }, title));
      if (!rows.length) t.appendChild(el("div", { class: "nu-pf-iempty" }, "—"));
      rows.slice(0, 12).forEach((r) => {
        t.appendChild(el("div", { class: "nu-pf-irow" }, el("span", { class: "nu-pf-ikey" }, r.key || "—"), el("span", { class: "nu-pf-icount nu-mono" }, String(r.count))));
      });
      return t;
    };
    const p = (v: unknown): Pair[] => (Array.isArray(v) ? (v as Pair[]) : []);
    const visits = d["visits"] as { last_7d?: unknown; last_30d?: unknown } | undefined;
    const fb = d["feedback"] as { average_stars?: number | null; latest?: Array<{ stars: number; text?: string | null; page?: string; at?: string }> } | undefined;

    wrap.appendChild(
      el(
        "div",
        { class: "nu-pf-stats" },
        el("div", { class: "nu-pf-stat" }, el("span", { class: "nu-pf-statn nu-mono" }, String(p(visits?.last_7d).reduce((a, r) => a + r.count, 0))), el("span", { class: "nu-pf-statl" }, "visits · 7d")),
        el("div", { class: "nu-pf-stat" }, el("span", { class: "nu-pf-statn nu-mono" }, String(p(visits?.last_30d).reduce((a, r) => a + r.count, 0))), el("span", { class: "nu-pf-statl" }, "visits · 30d")),
        el("div", { class: "nu-pf-stat" }, el("span", { class: "nu-pf-statn nu-mono" }, String(n(d["cv_downloads"]))), el("span", { class: "nu-pf-statl" }, "CV downloads")),
        el("div", { class: "nu-pf-stat" }, el("span", { class: "nu-pf-statn nu-mono" }, fb?.average_stars != null ? fb.average_stars.toFixed(1) + " ★" : "—"), el("span", { class: "nu-pf-statl" }, "avg feedback")),
      ),
    );
    const grid = el("div", { class: "nu-pf-igrid" });
    grid.appendChild(table("pages · 7d", p(visits?.last_7d)));
    grid.appendChild(table("pages · 30d", p(visits?.last_30d)));
    grid.appendChild(table("referrers", p(d["referrers"])));
    grid.appendChild(table("link clicks", p(d["link_clicks"])));
    grid.appendChild(table("settings picks", p(d["settings"])));
    grid.appendChild(table("viewports", p(d["viewport_bands"])));
    grid.appendChild(table("dwell", p(d["dwell_buckets"])));
    grid.appendChild(table("installs", p(d["installs"])));
    grid.appendChild(table("writing filters", p(d["writing_filters"])));
    wrap.appendChild(grid);

    const fbCol = el("div", { class: "nu-pf-fb" }, el("div", { class: "nu-pf-ititle" }, "feedback · latest"));
    const latest = fb?.latest ?? [];
    if (!latest.length) fbCol.appendChild(el("div", { class: "nu-pf-iempty" }, "none yet"));
    latest.forEach((f) => {
      fbCol.appendChild(
        el(
          "div",
          { class: "nu-pf-fbrow" },
          el("span", { class: "nu-pf-fbstars" }, "★".repeat(Math.max(0, Math.min(5, f.stars)))),
          el("span", { class: "nu-pf-fbtext" }, f.text || "(no note)"),
          el("span", { class: "nu-pf-fbmeta nu-mono" }, `${f.page ?? ""} · ${(f.at ?? "").slice(0, 16)}`),
        ),
      );
    });
    wrap.appendChild(fbCol);
    bodyHost.appendChild(wrap);
  }

  async function render(): Promise<void> {
    bodyHost.textContent = "";
    bodyHost.appendChild(el("div", { class: "nu-pf-iempty" }, "loading…"));
    try {
      if (tab === "articles") await renderArticles();
      else if (tab === "overview") await renderOverview();
      else if (tab === "cv") await renderCv();
      else await renderInsights();
    } catch (e) {
      fail(e);
    }
  }

  /* fresh data every time the app is shown — content changes elsewhere
     (another device, a publish) must never render stale */
  onAppChange((id) => {
    if (id === "portfolio") void render();
  });
  void render();
  return { el: root };
}

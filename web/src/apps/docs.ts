/* apps/docs.ts — the Docs app (CAS_25dbaded, docs/apps/DOCS.md): markdown documents as
   objects. A project-grouped list over GET /api/objects/document and an editor view =
   title + status + mountMdEditor + the CAS_b0d96f86 draft-guard. Save is POST (create) /
   PATCH If-Match (edit); a 412 KEEPS the draft and never repaints over the textarea. The
   live preview rides the Context panel via cfg.onPreview (the console canon — the
   half-open panel is the mobile view). HTTP mode only; registered behind a boot probe. */

import { el, icon, button, input, chip } from "amenan-ui";
import { ncl } from "../client.ts";
import { onAppChange } from "../shell/apps.ts";
import { mountMdEditor } from "./md-editor.ts";
import { createDraftGuard, type DraftGuard } from "./draft-guard.ts";

interface Ent {
  id: string;
  data: Record<string, unknown>;
  version: number;
  etag: string;
}

export interface DocsCfg {
  onToast(title: string, msg: string, tone?: string): void;
  /** hand the live preview node to the Context panel (null clears it). */
  onPreview?(node: HTMLElement | null): void;
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");

async function list(type: string): Promise<Ent[]> {
  const res = await ncl.request("GET", `/api/objects/${type}?limit=200`);
  if (res.status !== 200) throw new Error(`${type}: ${res.status}`);
  return ((res.body as { items?: Ent[] } | null)?.items ?? []) as Ent[];
}

/** the editable state, serialized for the draft-guard's string compare */
interface DocShape {
  title: string;
  md: string;
  status: string;
}
const snap = (d: DocShape): string => JSON.stringify(d);

export function mountDocs(host: Element, cfg: DocsCfg): { el: HTMLElement } {
  const root = el("div", { class: "nu-doc" });
  host.appendChild(root);
  const toast = cfg.onToast;

  let inEditor = false;
  let guard: DraftGuard | null = null;

  /* ── the list view ──────────────────────────────────────────────────────── */
  async function renderList(): Promise<void> {
    guard?.destroy();
    guard = null;
    inEditor = false;
    cfg.onPreview?.(null);
    root.textContent = "";

    let docs: Ent[] = [];
    let projects: Ent[] = [];
    try {
      [docs, projects] = await Promise.all([list("document"), list("project")]);
    } catch (e) {
      root.appendChild(el("div", { class: "nu-doc-empty" }, `could not load — ${String(e instanceof Error ? e.message : e)}`));
      return;
    }
    const projName = new Map(projects.map((p) => [p.id, s(p.data["name"]) || p.id]));

    const head = el(
      "div",
      { class: "nu-doc-head" },
      el("div", {}, el("h2", { class: "nu-doc-h" }, "Docs"), el("p", { class: "nu-doc-sub" }, "markdown documents — write, preview, save")),
      el("span", { class: "nu-spring" }),
    );
    if (projects.length) {
      head.appendChild(
        button({
          label: "New document",
          icon: "bi-plus-lg",
          size: "sm",
          variant: "accent",
          onClick: () => {
            const first = projects[0];
            if (first) openEditor(null, first.id, projects);
          },
        }),
      );
    }
    root.appendChild(head);

    const listEl = el("div", { class: "nu-doc-list nu-scroll" });
    if (!docs.length) {
      listEl.appendChild(
        el("div", { class: "nu-doc-empty" }, projects.length ? "No documents yet — create the first one." : "No projects yet — create a project first (Objects rail), then documents can live in it."),
      );
    }
    /* group by project */
    const byProj = new Map<string, Ent[]>();
    docs.forEach((d) => {
      const pid = s(d.data["project_id"]);
      byProj.set(pid, [...(byProj.get(pid) ?? []), d]);
    });
    byProj.forEach((items, pid) => {
      listEl.appendChild(el("div", { class: "nu-doc-group" }, projName.get(pid) ?? pid));
      items.forEach((d) => {
        const status = s(d.data["status"]) || "draft";
        const row = el(
          "button",
          { class: "nu-doc-row", type: "button" },
          icon("file-earmark-text"),
          el("span", { class: "nu-doc-rowtitle" }, s(d.data["title"]) || d.id),
          el("span", { class: `nu-doc-status${status === "final" ? " is-final" : ""}` }, status),
          el("span", { class: "nu-doc-rowmeta" }, `v${d.version}`),
        );
        row.addEventListener("click", () => openEditor(d, s(d.data["project_id"]), projects));
        listEl.appendChild(row);
      });
    });
    root.appendChild(listEl);
  }

  /* ── the editor view ────────────────────────────────────────────────────── */
  function openEditor(item: Ent | null, projectId: string, projects: Ent[]): void {
    guard?.destroy();
    inEditor = true;
    root.textContent = "";

    const cur: DocShape = item
      ? { title: s(item.data["title"]), md: s(item.data["md"]), status: s(item.data["status"]) || "draft" }
      : { title: "", md: "", status: "draft" };
    let etag = item?.etag ?? "";
    let id = item?.id ?? "";

    const wrap = el("div", { class: "nu-doc-editor" });

    /* head: back · title · status chips · project (create only) · dirty badge · save */
    const titleIn = input({ value: cur.title, placeholder: "Title", onInput: (v) => { cur.title = v; touched(); } });
    titleIn.classList.add("nu-doc-title");

    const dirtyBadge = el("span", { class: "nu-doc-dirty", hidden: "hidden" }, "unsaved");
    const chips = el("span", {});
    const paintChips = (): void => {
      chips.textContent = "";
      (["draft", "final"] as const).forEach((st) => {
        chips.appendChild(chip({ label: st, active: cur.status === st, onClick: () => { cur.status = st; paintChips(); touched(); } }));
      });
    };
    paintChips();

    let projSel: HTMLSelectElement | null = null;
    if (!item && projects.length > 1) {
      projSel = el("select", { class: "nu-doc-sel", "aria-label": "Project" }) as HTMLSelectElement;
      projects.forEach((p) => {
        const o = el("option", { value: p.id }, s(p.data["name"]) || p.id) as HTMLOptionElement;
        if (p.id === projectId) o.selected = true;
        projSel?.appendChild(o);
      });
    }

    const saveBtn = button({ label: item ? "Save" : "Create", icon: "bi-check-lg", size: "sm", variant: "accent", onClick: () => void save() });
    saveBtn.toggleAttribute("disabled", true);

    const head = el(
      "div",
      { class: "nu-doc-head" },
      button({ icon: "bi-arrow-left", size: "sm", variant: "ghost", title: "Back to documents", onClick: () => void renderList() }),
      titleIn,
      chips,
      ...(projSel ? [projSel] : []),
      el("span", { class: "nu-spring" }),
      dirtyBadge,
      button({ label: "Preview", icon: "bi-eye", size: "sm", variant: "ghost", onClick: () => { editor.setValue(editor.value(), { silent: true }); cfg.onPreview?.(editor.previewEl); } }),
      saveBtn,
    );
    wrap.appendChild(head);

    /* draft bar sits between the head and the editor */
    const barHost = el("div", {});
    wrap.appendChild(barHost);

    const editor = mountMdEditor(wrap, {
      value: cur.md,
      rows: 18,
      onChange: (v) => {
        cur.md = v;
        touched();
      },
    });

    guard = createDraftGuard({
      storageKey: `numu_draft_document_${id || `new_${projectId}`}`,
      baseVersion: etag,
      serverValue: snap(item ? { title: s(item.data["title"]), md: s(item.data["md"]), status: s(item.data["status"]) || "draft" } : { title: "", md: "", status: "draft" }),
      getValue: () => snap(cur),
      onRestore: (v) => {
        try {
          const d = JSON.parse(v) as DocShape;
          cur.title = d.title;
          cur.md = d.md;
          cur.status = d.status;
          titleIn.value = d.title;
          paintChips();
          editor.setValue(d.md, { silent: true });
          touched();
        } catch {
          toast("Docs", "draft could not be parsed", "warn");
        }
      },
      onDirtyChange: (dirty) => {
        dirtyBadge.hidden = !dirty;
        saveBtn.toggleAttribute("disabled", !dirty);
      },
    });
    barHost.appendChild(guard.bar);

    const touched = (): void => guard?.touch();

    async function save(): Promise<void> {
      if (!cur.title.trim()) {
        toast("Docs", "a title is required", "warn");
        return;
      }
      if (id) {
        const res = await ncl.request("PATCH", `/api/objects/document/${id}`, {
          body: { title: cur.title, md: cur.md, status: cur.status },
          headers: { "If-Match": etag },
        });
        if (res.status === 200) {
          const body = res.body as { etag?: string; version?: number } | null;
          etag = body?.etag ?? res.headers?.ETag ?? etag;
          guard?.markClean(etag, snap(cur));
          toast("Docs", `saved · v${body?.version ?? "?"}`, "ok");
        } else if (res.status === 412) {
          guard?.keepDraftOn412();
          toast("Docs", "changed elsewhere — your edits are kept as a draft; reopen to merge", "danger");
        } else {
          toast("Docs", (res.body as { detail?: string } | null)?.detail ?? `save failed (${res.status})`, "danger");
        }
        return;
      }
      const pid = projSel?.value ?? projectId;
      const res = await ncl.request("POST", "/api/objects/document", {
        body: { project_id: pid, title: cur.title, md: cur.md, status: cur.status },
      });
      if (res.status === 201) {
        const body = res.body as { id?: string; etag?: string; version?: number } | null;
        id = body?.id ?? "";
        etag = body?.etag ?? res.headers?.ETag ?? "";
        guard?.markClean(etag, snap(cur));
        toast("Docs", `created ${id}`, "ok");
      } else {
        toast("Docs", (res.body as { detail?: string } | null)?.detail ?? `create failed (${res.status})`, "danger");
      }
    }

    root.appendChild(wrap);
    cfg.onPreview?.(editor.previewEl);
    editor.focus();
  }

  /* kept-alive refresh rule (CAS_b0d96f86): refresh the LIST when this app shows —
     NEVER a dirty editor, and never yank an open editor at all. */
  onAppChange((id) => {
    if (id !== "docs") return;
    if (inEditor) return; // an open editor is sacred, dirty or not
    void renderList();
  });

  void renderList();
  return { el: root };
}

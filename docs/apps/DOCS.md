# The Docs app — a vanilla-TS Markdown editor (console tier)

> Markdown documents as first-class objects, edited in the console (CAS_25dbaded). This doc is
> the contract for the `document` type (migration 0025), the reusable editor core
> (`web/src/apps/md-editor.ts`), and the **draft-guard** discipline every console editor adopts
> (CAS_b0d96f86). Related: [`../frontend/CONSOLE.md`](../frontend/CONSOLE.md) (the four-region
> canon) · [`../api/OBJECTS.md`](../api/OBJECTS.md) (objects-as-data) ·
> [`PORTFOLIO.md`](PORTFOLIO.md) (whose article/CV editors adopt this core in a follow-up).

## The decision: react-md-editor is a spec, not code

Em proposed converting [react-md-editor](https://github.com/uiwjs/react-md-editor) into a numu
app. **We do not port or bundle React.** It drags react + react-dom + the rehype/remark chain —
against the zero-dependency vanilla-TS discipline — and ships its own CSS-var theme (a fork the
css-drift gates exist to prevent). Its actual architecture is textarea + command toolbar +
rendered preview, and numu already owns each piece: the wrap-selection toolbar pattern
(`md-inline.ts`), the ONE safe block renderer (amenan-ui `renderMarkdown`), the generic object
CRUD with If-Match, and the context-panel preview plumbing. react-md-editor therefore serves as
the **feature checklist** below; the code is composed from what we own.

## The `document` type (migration 0025 — registry rows, never DDL)

| field | kind | required | editable | notes |
|---|---|---|---|---|
| `project_id` | ref → PRJ | yes | no (set-once) | scope parent — reach cascades project → document (leak-free 404s ride the project edge) |
| `title` | text | yes | yes | |
| `md` | text | no | yes | default `""` — a doc is legitimately created empty |
| `status` | enum `draft · final` | no | yes | default `draft`. Deliberately NOT “published”: nothing publishes a document, and UI state must never overclaim (CAS_b0d96f86 rule 4) |

`document` (prefix `DOC`, ordinal 220) **succeeds the retired-by-decision `note` type** — do not
build on `note`. CRUD is the generic `/api/objects/document` surface (ETag/If-Match, 412 on
stale). Registry loads at boot: restart the api after applying 0025.

## The editor core — `mountMdEditor(host, cfg)`

`web/src/apps/md-editor.ts` → `{ el, previewEl, value(), setValue(v, {silent?}), focus() }`.

- **Toolbar**: heading (cycle `#`→`##`→`###`→none) · bold · italic · inline code · fenced code ·
  quote · ul · ol · link. Every command is pure selection algebra in `md-ops.ts`
  (`wrapSel` / `prefixLines` / `cycleHeading` on `{value, start, end}`) — DOM-free, covered by
  `web/tests/md-ops.test.ts`.
- **Shortcuts**: Ctrl/Cmd+B / I / K, bound on the **textarea only** (never document-level — the
  composer owns global keys), `preventDefault` on exact match.
- **Live preview**: `previewEl` re-rendered through amenan `renderMarkdown` (debounced ~150 ms).
  The HOST decides where the preview lives; the Docs app hands it to the Context panel via
  `cfg.onPreview` — the half-open panel IS the mobile view (no 360 px split-pane).
- `mdField` (`md-inline.ts`) is untouched: it speaks the locked pdf.rs **inline** contract for
  the CV editor; this component speaks full block markdown.

**v1 non-goals** (explicit): tables · strikethrough · checklist · hr (renderer support first,
one later upstream batch) · image upload (no blob endpoint exists; the safe renderer emits no
`<img>`) · syntax-highlight overlay · KaTeX/mermaid (external deps) · fullscreen.

**Headings** land upstream in amenan-ui's `renderMarkdown` (h1–h6 through the existing safe
`inline()` path; sheet already in the web-build concat) — Em unlocked the freeze for this one
bounded change; the repo refreezes after. ONE renderer, no numu-side fork.

## The draft-guard — no editor loses work again (CAS_b0d96f86)

`web/src/apps/draft-guard.ts` — `createDraftGuard({storageKey, baseVersion, serverValue,
getValue, onRestore, onDirtyChange})` → `{bar, dirty(), markClean(), keepDraftOn412(), destroy()}`.

- Debounced (~1 s) autosave of `{v, base, at}` to localStorage (quota-safe try/catch).
- On mount, a stored draft that differs from the server value shows the restore bar:
  **“Restore draft from HH:MM — Restore / Discard”** (with a “server changed since” variant when
  the draft’s base ≠ the current version).
- `beforeunload` is registered **only while dirty**; `onDirtyChange` drives the
  disabled-when-clean Save button and the dirty badge.
- On save 2xx → `markClean(newBase, newServer)` clears the draft; on **412 → the draft is
  KEPT** (`keepDraftOn412()`) and the editor never repaints over the textarea.
- `destroy()` unhooks listeners/timers — console surfaces are kept-alive.
- **Kept-alive refresh rule**: an app’s `onAppChange` refresh must be guarded by `dirty()` —
  refresh lists, never a dirty editor. (The un-guarded refresh is exactly how the CV edits were
  lost.)

Consumers: the Docs app now; the portfolio article/CV editors in a follow-up Case.

## The Docs app — `mountDocs(host, {onToast, onPreview})`

`web/src/apps/docs.ts`, cloning the portfolio mount shape: a project-grouped list over
`GET /api/objects/document`, and an editor view (title input + md-editor + draft bar). Save =
POST (create) / PATCH If-Match (edit). Registration in `app.ts`: HTTP-mode only behind a boot
probe (`GET /api/objects/document?limit=1` → 200), `order: 45`, `objectRail: false`, icon
`file-earmark-text`; the Store card appears as installed automatically once the probe admits —
the sim plane is untouched (sim-verbatim stays byte-identical).

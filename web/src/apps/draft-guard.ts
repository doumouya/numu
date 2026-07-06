/* apps/draft-guard.ts — no console editor loses work again (CAS_b0d96f86, docs/apps/DOCS.md).
   Born from Em losing a morning of CV edits: the doc lived in memory, the tab closed, and Save
   had never landed. This module is the reusable net every editor mounts:

   · debounced localStorage autosave of the in-progress value (device-local, quota-safe);
   · a restore bar on mount when a draft newer than the server value exists;
   · beforeunload only WHILE dirty; onDirtyChange drives the disabled-when-clean Save + badge;
   · on save 2xx → markClean() clears the draft; on 412 → keepDraftOn412() KEEPS it (never
     repaint over the textarea);
   · destroy() unhooks everything — console surfaces are kept-alive.

   Consumers: the Docs app now; the portfolio article/CV editors in the follow-up Case. */

import { el, icon, button } from "amenan-ui";

interface StoredDraft {
  v: string;
  base: string;
  at: number;
}

export interface DraftGuardCfg {
  /** localStorage key, e.g. `numu_draft_document_DOC_…` (or `…_new` before first save). */
  storageKey: string;
  /** the version/etag this editing session opened at ("" for a create). */
  baseVersion: string;
  /** the clean server value — dirty means getValue() !== the current baseline. */
  serverValue: string;
  getValue(): string;
  /** apply a restored draft into the editor (the guard never touches the editor itself). */
  onRestore(v: string): void;
  onDirtyChange(dirty: boolean): void;
}

export interface DraftGuard {
  /** the restore strip — mount it above the editor; hidden when there is nothing to restore. */
  bar: HTMLElement;
  dirty(): boolean;
  /** call on every editor input — schedules the debounced draft write + dirty recompute. */
  touch(): void;
  /** after a 2xx save: clear the draft, rebase the clean state. */
  markClean(newBase: string, newServerValue: string): void;
  /** after a 412: the draft stays; the bar explains the conflict instead of vanishing. */
  keepDraftOn412(): void;
  destroy(): void;
}

const read = (key: string): StoredDraft | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as StoredDraft;
    return typeof d.v === "string" ? d : null;
  } catch {
    return null;
  }
};

const hhmm = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function createDraftGuard(cfg: DraftGuardCfg): DraftGuard {
  let base = cfg.baseVersion;
  let server = cfg.serverValue;
  let isDirty = false;
  let timer: number | undefined;
  let destroyed = false;

  const bar = el("div", { class: "nu-draftbar", hidden: "hidden" });

  const write = (): void => {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify({ v: cfg.getValue(), base, at: Date.now() } satisfies StoredDraft));
    } catch {
      /* quota — the guard degrades to dirty-tracking only */
    }
  };
  const clear = (): void => {
    try {
      localStorage.removeItem(cfg.storageKey);
    } catch {
      /* quota */
    }
  };

  const recompute = (): void => {
    const now = cfg.getValue() !== server;
    if (now !== isDirty) {
      isDirty = now;
      cfg.onDirtyChange(isDirty);
    }
  };

  /* beforeunload only while dirty — a clean editor never nags */
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!isDirty) return;
    write(); // last-chance draft flush
    e.preventDefault();
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  const paintBar = (msg: string, draft: StoredDraft): void => {
    bar.hidden = false;
    bar.textContent = "";
    bar.appendChild(icon("clock-history"));
    bar.appendChild(el("span", { class: "nu-draftbar-msg" }, msg));
    bar.appendChild(el("span", { class: "nu-spring" }));
    bar.appendChild(
      button({
        label: "Restore",
        size: "sm",
        variant: "accent",
        onClick: () => {
          cfg.onRestore(draft.v);
          bar.hidden = true;
          recompute();
          write();
        },
      }),
    );
    bar.appendChild(
      button({
        label: "Discard",
        size: "sm",
        variant: "ghost",
        onClick: () => {
          clear();
          bar.hidden = true;
        },
      }),
    );
  };

  /* mount check: a stored draft that differs from the server value is worth offering */
  const stored = read(cfg.storageKey);
  if (stored && stored.v !== server) {
    paintBar(
      stored.base === base
        ? `Unsaved draft from ${hhmm(stored.at)}`
        : `Unsaved draft from ${hhmm(stored.at)} — the server changed since`,
      stored,
    );
  } else if (stored) {
    clear(); // draft equals the server value — stale noise
  }

  return {
    bar,
    dirty: () => isDirty,
    touch(): void {
      if (destroyed) return;
      recompute();
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(write, 1000);
    },
    markClean(newBase: string, newServerValue: string): void {
      base = newBase;
      server = newServerValue;
      clear();
      if (timer !== undefined) window.clearTimeout(timer);
      bar.hidden = true;
      recompute();
    },
    keepDraftOn412(): void {
      write(); // persist immediately — the conflict must never cost the work
      const d = read(cfg.storageKey);
      if (d) paintBar("Changed elsewhere — your edits are kept as a draft", d);
    },
    destroy(): void {
      destroyed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("beforeunload", onBeforeUnload);
    },
  };
}

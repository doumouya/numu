/* client.ts — the typed face of the NumuClient seam. The console talks ONLY to
   `ncl` (and the id helpers): the seam is the app/backend boundary, so phase B
   (the Rust api behind the http driver) is a driver swap, not an app change.
   The driver is chosen once, before app code runs, off window.NUMU_HTTP
   (web/index.html) — exactly as the design project's console does. */

export const ncl: NumuClientApi = (window.numuClient =
  window.numuClient ?? (window.NUMU_HTTP ? window.NumuClient.http("") : window.NumuClient.local()));

/** tenant rail id → the workspace (ORG) entity id the engine scopes by */
export const ORG_OF: Record<string, string> = { studio: "ORG_orvcle", platform: "ORG_numu" };

/** projects-panel id → the project (PRJ) entity id */
export const PRJ_OF = (id: string): string => "PRJ_" + id;

/** Prefetch column-distinct values for the autocomplete's lazy field-domain
    plane: first string columns only, capped, filled into the window-global
    cache the suggester reads (window.__NUMU_VALUES). */
export function prefetchValues(rid: string, columns: NumuColumnMeta[] | undefined): void {
  const store = (window.__NUMU_VALUES = window.__NUMU_VALUES ?? {});
  const bag = (store[rid] = store[rid] ?? {});
  (columns ?? [])
    .filter((c) => c.semantic_dtype === "string" || c.dtype === "string")
    .slice(0, 8)
    .forEach((c) => {
      void ncl.values(rid, c.name).then((vals) => {
        bag[c.name.toLowerCase()] = vals ?? [];
      });
    });
}

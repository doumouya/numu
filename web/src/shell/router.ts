/* shell/router.ts — hash routes (#/<app>[/sub]) over the kept-alive app
   registry. showApp() is the single sink (shell/apps.ts); the router only
   translates location.hash ⇄ app ids. The OAuth return-stash survives the
   Google round-trip (the hash does not survive a 302 chain): stash before
   leaving, replay after the gate readmits. */

import { currentApp, getApp, showApp, type AppId } from "./apps.ts";

const STASH_KEY = "nu-return";

export interface Route {
  app: AppId;
  sub: string;
}

export function parseHash(hash: string, fallback: AppId): Route {
  const m = /^#\/([a-z0-9-]+)(?:\/(.*))?$/.exec(hash);
  return m ? { app: m[1] ?? fallback, sub: m[2] ?? "" } : { app: fallback, sub: "" };
}

/** Navigate = write the hash; the hashchange listener does the showing. */
export function navigate(app: AppId, sub = ""): void {
  const next = "#/" + app + (sub ? "/" + sub : "");
  if (location.hash === next) return;
  location.hash = next;
}

export function initRouter(defaultApp: AppId): void {
  const apply = (): void => {
    const r = parseHash(location.hash, defaultApp);
    if (getApp(r.app)?.available() && r.app !== currentApp()) showApp(r.app);
    else if (!getApp(r.app)?.available() && currentApp() === null) showApp(defaultApp);
  };
  window.addEventListener("hashchange", apply);
  apply();
}

/** Stash the current hash before the OAuth redirect leaves the origin. */
export function stashReturn(): void {
  try {
    if (location.hash) sessionStorage.setItem(STASH_KEY, location.hash);
  } catch {
    /* private mode */
  }
}

/** Replay (once) the stashed hash after the gate readmits. */
export function replayReturn(): void {
  try {
    const h = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    if (h && !location.hash) history.replaceState(null, "", h);
  } catch {
    /* private mode */
  }
}

/* shell/apps.ts — the AppPage registry + the single center-visibility sink.
   The console v2 canon (docs/frontend/CONSOLE.md): the far-left Apps Rail lists
   registered apps; showApp() swaps which kept-alive center SURFACE is visible
   and whether the Object Rail applies. Every route answers the click contract:
   what does the center show, what does the Context panel show — the center is
   the app's surface; the context is driven by selections INSIDE it. */

export type AppId = string;

export interface AppPage {
  id: AppId;
  label: string;
  /** bootstrap-icons glyph for the Apps Rail. */
  icon: string;
  /** one-liner for the rail flyout. */
  desc: string;
  /** rail order (ascending). */
  order: number;
  /** whether this app exists for the current driver/caller (Store honesty rides this). */
  available(): boolean;
  /** the kept-alive center surface — mounted once by its owner, hidden-toggled here. */
  surface: HTMLElement;
  /** whether the Object Rail (channels→projects tree) accompanies this app. */
  objectRail: boolean;
}

const registry = new Map<AppId, AppPage>();
let current: AppId | null = null;
const listeners = new Set<(id: AppId) => void>();

export function registerApp(app: AppPage): void {
  registry.set(app.id, app);
}

export function appList(): AppPage[] {
  return [...registry.values()].filter((a) => a.available()).sort((a, b) => a.order - b.order);
}

export function getApp(id: AppId): AppPage | undefined {
  return registry.get(id);
}

export function currentApp(): AppId | null {
  return current;
}

/** The one place center surfaces are hidden/shown. Unknown/unavailable ids no-op. */
export function showApp(id: AppId): void {
  const target = registry.get(id);
  if (!target || !target.available()) return;
  current = id;
  registry.forEach((a) => {
    a.surface.hidden = a.id !== id;
  });
  listeners.forEach((fn) => fn(id));
}

/** Subscribe to app switches (rail active state, composer page, topbar). */
export function onAppChange(fn: (id: AppId) => void): void {
  listeners.add(fn);
}

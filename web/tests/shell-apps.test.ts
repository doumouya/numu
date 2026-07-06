// shell-apps.test.ts — the app registry + hash routing, pure (no DOM):
// registration/availability, the showApp single sink, and parseHash.
// Run: node --test web/tests/   (node strips the types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerApp, appList, showApp, currentApp, onAppChange, type AppPage } from "../src/shell/apps.ts";
import { parseHash } from "../src/shell/router.ts";

// a center surface stand-in — the registry only ever touches `.hidden`
const surface = (): HTMLElement => ({ hidden: true }) as unknown as HTMLElement;

function app(id: string, order: number, available = true): AppPage {
  return {
    id,
    label: id,
    icon: "app",
    desc: id,
    order,
    available: () => available,
    surface: surface(),
    objectRail: true,
  };
}

test("showApp is the single visibility sink over kept-alive surfaces", () => {
  const a = app("workspace", 10);
  const b = app("store", 90);
  registerApp(a);
  registerApp(b);
  showApp("workspace");
  assert.equal(a.surface.hidden, false);
  assert.equal(b.surface.hidden, true);
  assert.equal(currentApp(), "workspace");
  showApp("store");
  assert.equal(a.surface.hidden, true);
  assert.equal(b.surface.hidden, false);
});

test("an unavailable app never shows and never becomes current", () => {
  const ghost = app("ghost", 50, false);
  registerApp(ghost);
  const before = currentApp();
  showApp("ghost");
  assert.equal(ghost.surface.hidden, true);
  assert.equal(currentApp(), before);
  assert.ok(!appList().some((x) => x.id === "ghost"), "appList filters unavailable apps");
});

test("appList orders by rail order", () => {
  assert.deepEqual(
    appList().map((x) => x.id),
    ["workspace", "store"],
  );
});

test("onAppChange notifies with the shown id", () => {
  let seen = "";
  onAppChange((id) => {
    seen = id;
  });
  showApp("workspace");
  assert.equal(seen, "workspace");
});

test("parseHash maps #/<app>[/sub] and falls back", () => {
  assert.deepEqual(parseHash("#/store", "workspace"), { app: "store", sub: "" });
  assert.deepEqual(parseHash("#/portfolio/articles", "workspace"), { app: "portfolio", sub: "articles" });
  assert.deepEqual(parseHash("", "workspace"), { app: "workspace", sub: "" });
  assert.deepEqual(parseHash("#garbage", "workspace"), { app: "workspace", sub: "" });
});

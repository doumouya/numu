// shell-auth.test.ts — the boot gate's decision machine, pure (no DOM):
// 200 → in (store + client actor aligned) · 401 → login · anything else /
// throw → login FAIL-CLOSED with the unreachable note · malformed 200 body
// never boots the console.
// Run: node --test web/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { auth, fetchMe, doLogout } from "../src/shell/auth.ts";

const client = (status: number, body: unknown = null, fail = false): NumuClientApi =>
  ({
    kind: "http",
    actor: "",
    request: async () => {
      if (fail) throw new Error("network down");
      return { status, body };
    },
  }) as unknown as NumuClientApi;

const ME = {
  actor_id: "USR_x",
  display_name: "Em",
  handle: "em",
  email: "em@numu.im",
  avatar_url: "https://lh3.g/em.jpg",
  platform_role: "admin",
};

test("200 with a valid body admits and aligns the client actor", async () => {
  const c = client(200, ME);
  const gate = await fetchMe(c);
  assert.equal(gate.kind, "in");
  assert.equal(auth.identity?.actor_id, "USR_x");
  assert.equal(c.actor, "USR_x");
  auth.identity = null;
});

test("401 lands on login with no error note", async () => {
  const gate = await fetchMe(client(401, { detail: "Authentication required" }));
  assert.deepEqual(gate, { kind: "login" });
});

test("5xx / 404 / network failure fail CLOSED to login with the unreachable note", async () => {
  for (const g of [
    await fetchMe(client(500)),
    await fetchMe(client(404, "<!doctype html>")),
    await fetchMe(client(0, null, true)),
  ]) {
    assert.equal(g.kind, "login");
    assert.match((g as { error?: string }).error ?? "", /unreachable/);
  }
});

test("a malformed 200 body never boots the console", async () => {
  const gate = await fetchMe(client(200, { nope: true }));
  assert.equal(gate.kind, "login");
  assert.equal(auth.identity, null);
});

test("logout maps 204 → true, anything else → false", async () => {
  assert.equal(await doLogout(client(204)), true);
  assert.equal(await doLogout(client(500)), false);
  assert.equal(await doLogout(client(0, null, true)), false);
});

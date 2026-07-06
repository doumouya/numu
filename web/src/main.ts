/* main.ts — the console's boot entry (console v2, CAS_0cc48a29). Sim mode
   boots straight into the console with the sim canon; HTTP mode gates on
   GET /auth/me first — a logged-out visitor gets the login page and the
   console's DOM is never built (the dynamic import stays unexecuted).
   esbuild (no splitting) lowers import() to a lazy require: the app module
   body runs at await time, not at bundle eval. */

import { el } from "amenan-ui";
import { ncl } from "./client.ts";
import { fetchMe } from "./shell/auth.ts";
import { renderLogin, loginErrorFromUrl } from "./shell/login.ts";
import { replayReturn } from "./shell/router.ts";

const root = document.getElementById("root");
if (!root) throw new Error("no #root");

if (ncl.kind !== "http") {
  void import("./app.ts");
} else {
  const splash = el("div", { class: "nu-boot" }, el("div", { class: "nu-login-mark" }, "nu"));
  root.appendChild(splash);
  void fetchMe(ncl).then((gate) => {
    splash.remove();
    if (gate.kind === "in") {
      replayReturn();
      void import("./app.ts");
    } else {
      renderLogin(root, { error: gate.error ?? loginErrorFromUrl() });
    }
  });
}

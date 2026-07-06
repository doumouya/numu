/* shell/login.ts — the console's front door: one page, one button. The OAuth
   callback's failure slugs (?error=denied|auth_failed, oauth.rs
   callback_redirect) render here as human copy; the URL is scrubbed after
   reading so a retry starts clean. */

import { el, icon } from "amenan-ui";
import { stashReturn } from "./router.ts";

const ERROR_COPY: Record<string, string> = {
  denied: "Access denied — this console is for allowed accounts only.",
  auth_failed: "Sign-in failed — try again.",
};

/** Read (and scrub) the callback's ?error= slug from the URL. */
export function loginErrorFromUrl(): string | undefined {
  const slug = new URLSearchParams(location.search).get("error");
  if (!slug) return undefined;
  const clean = location.pathname + location.hash;
  history.replaceState(null, "", clean);
  return ERROR_COPY[slug] ?? ERROR_COPY["auth_failed"];
}

export function renderLogin(host: HTMLElement, opts?: { error?: string }): void {
  host.textContent = "";
  const error = opts?.error;
  host.appendChild(
    el(
      "div",
      { class: "nu-login" },
      el("div", { class: "nu-login-mark" }, "nu"),
      el("div", { class: "nu-login-title" }, "numu — console"),
      el("div", { class: "nu-login-sub" }, "talk to your org's objects"),
      el(
        "button",
        {
          class: "nu-login-btn",
          onclick: () => {
            stashReturn();
            location.href = "/auth/google/start";
          },
        },
        icon("google"),
        el("span", {}, "Continue with Google"),
      ),
      error ? el("div", { class: "nu-login-err", role: "alert" }, error) : el("span", { hidden: "hidden" }),
    ),
  );
}

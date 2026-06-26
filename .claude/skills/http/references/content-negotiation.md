# Content negotiation (RFC 9110 §12, §8)

How the client and server agree on representation. numu's default is plain `application/json` everywhere,
so negotiation is light — but the rules matter for correctness (right codes) and for connectors talking to
arbitrary upstreams.

## Request side
- **`Content-Type`** (on a body verb — POST/PUT/PATCH) declares what the client is *sending*. If the
  server can't process it → **415 Unsupported Media Type**. numu accepts `application/json`; PATCH also
  accepts `application/merge-patch+json` (and treats `application/json` as merge-patch).
- **`Accept`** declares what the client *wants back*. If the server can't produce any acceptable type →
  **406 Not Acceptable**. numu produces `application/json` for success and `application/problem+json` for
  errors; an `Accept` that excludes both → 406 (in practice clients send `*/*`).
- **`Accept-Encoding`** (gzip/br) and **`Accept-Language`** exist too; numu defers content-encoding to the
  reverse proxy and is single-language in v1 (no `Accept-Language` branching).

## Response side
- Always set `Content-Type` on a body response: `application/json; charset=utf-8` for success,
  `application/problem+json; charset=utf-8` for errors.
- **`Vary`** lists the request headers that change the response, so shared caches don't serve the wrong
  variant. If a response depends on `Accept`, send `Vary: Accept`. **Anything reach-scoped depends on the
  caller** → it must be `Cache-Control: no-store` (preferred) or, if cached, `Vary: Authorization` /
  cookie — otherwise a shared cache can leak one user's data to another. (See conditional-requests.md.)

## 415 vs 406 (don't swap them)
- **415** = "*I* can't read what *you sent*" (wrong request `Content-Type`).
- **406** = "*I* can't produce what *you asked for*" (unsatisfiable `Accept`).

## Connectors (outbound — see client.md)
When pulling an external source, **send `Accept`** for the format you can parse and **check the response
`Content-Type`** before parsing — don't assume an endpoint that "should" return JSON did (an error page is
often `text/html`). A `Content-Type` mismatch is a clean, debuggable failure (map to a 502/connector
error), not a JSON-parse panic. Cap the body and stream it (max-body, client.md) regardless of the
declared type.

## charset
Always `utf-8`. Declare it (`; charset=utf-8`) so a client never guesses; never emit non-UTF-8 bytes from
a JSON API.

# The SSRF / TLS gate — copy-paste-grade invariants

**This is the load-bearing security control for every outbound request** (connectors, webhooks, any
server-side fetch). Server-Side Request Forgery (SSRF) = tricking the server into making a request to a
host the attacker couldn't reach directly — cloud metadata endpoints, internal admin panels, the DB. The
gate runs **before connect()** on **every** request, including each redirect hop. There are no exceptions
— not for TLS, not for "internal" URLs, not for "trusted" connectors.

## The one rule that defeats the whole bypass class
> **Classify the IP address the kernel will actually `connect()` to — not the string the user typed.**

Almost every bypass is a string that *looks* external but *resolves/normalizes* to an internal address.
So: parse the URL → extract the host → **resolve it to the IP(s) you will connect to** → classify *those
IPs* against the block list → if any is blocked, refuse (and pin the connection to the vetted IP so DNS
can't rebind between check and connect — see TOCTOU below).

## Blocked address ranges (classify the resolved IP)
| Range | Why |
|---|---|
| `127.0.0.0/8`, `::1` | loopback |
| `0.0.0.0/8`, `::` (unspecified) | "this host" — often routes to loopback |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC 1918 private |
| `169.254.0.0/16`, `fe80::/10` | link-local — incl. **`169.254.169.254` cloud metadata** (the crown-jewel SSRF target) |
| `fc00::/7` | IPv6 unique-local (private) |
| `100.64.0.0/10` | CGNAT |
| `::ffff:0:0/96` (IPv4-mapped), `64:ff9b::/96` (NAT64), `2002::/16` (6to4) | v6 wrappers around a v4 — **unwrap, then classify the inner v4** |
| multicast / reserved / broadcast | not a legitimate fetch target |

## The canonical bypass vectors (the regression checklist)
A correct gate must block **every** spelling of a blocked host. These are the forms attackers use; each
must be normalized to its resolved IP and rejected. (Machine-readable list: `../scripts/ssrf-vectors.txt`.)
1. `http://169.254.169.254/…` — direct metadata IP.
2. `http://[::ffff:169.254.169.254]/…` — IPv4-mapped IPv6 wrapper.
3. `http://[::ffff:a9fe:a9fe]/…` — the same, hex form.
4. `http://2852039166/…` — **decimal** integer IP (= 169.254.169.254).
5. `http://0xA9.0xFE.0xA9.0xFE/…` — **hex** octets.
6. `http://0251.0376.0251.0376/…` — **octal** octets.
7. `http://169.254.169.254.nip.io/…` — a public DNS name that **resolves to** the metadata IP.
8. `http://metadata.google.internal/…` — a name resolving to a link-local IP.
9. `http://[fe80::1%25eth0]/…` — IPv6 **zone id** (`%eth0`, percent-encoded) — strip the RFC 4007 zone, then classify.
10. `http://localhost./…` — **trailing-dot** FQDN (bypasses naive `== "localhost"` checks).
11. `http://LOCALHOST/…` / mixed case — case-insensitive host match.
12. A `30x` **redirect** from an allowed host *to* `169.254.169.254` — **re-run the gate on every hop**.

The lesson from each: never string-match the host; **normalize (lowercase, strip trailing dot, strip zone,
unwrap v6→v4, parse numeric forms) → resolve → classify the IP.**

## TLS / scheme rules
- Allow only `http`/`https` schemes (reject `file:`, `gopher:`, `ftp:`, `data:`, `dict:` — classic SSRF
  pivots).
- **Remote hosts MUST use `https`.** Plaintext `http` is permitted only to explicitly-allowed local dev
  hosts (and those are blocked in prod anyway). Verify the TLS chain; do not disable cert verification.

## TOCTOU (time-of-check / time-of-use) — DNS rebinding
A name can resolve to a safe IP at check time and a blocked IP at connect time (DNS rebinding). Defeat it:
resolve once, **classify that exact IP, then connect to that pinned IP** (not re-resolve the name). If the
HTTP client can't pin, use a custom resolver/connector that returns only the vetted address.

## Redirects
Cap at 5 hops (client.md). **Re-run this entire gate on every redirect target** before following it — an
allowed host redirecting to `169.254.169.254` is vector #12 and the most common real-world SSRF. A
redirect to a blocked IP → refuse (don't follow) → map to a 400-class connector error.

## On refusal
Refuse before connect; surface a generic, leak-free problem+json (`kind: outbound_blocked`, status 400)
with the request-id. Log the *attempted* host server-side (with the request-id) so the block is
auditable — but never echo the internal target back to the caller.

## Tests are mandatory the day the gate lands
Turn the 12 vectors above into 12 unit tests (each must return "blocked") plus a couple of positive cases
(a real public host must pass). This is the regression net — without it the gate silently rots when the
client library changes.

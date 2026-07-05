# Getting started — zero to a running numu

The fastest path from a fresh clone to a console you can talk to. Every step here was run on a
clean throwaway database before it was written; the outputs are what you should actually see. When
you want the *why* behind a step, the **See also** links point at the contract. Operational detail
(env vars, connecting a custom frontend) lives in [`api/RUNNING.md`](api/RUNNING.md); this is the
on-ramp.

## What numu is (one paragraph)

A single Rust binary (`numu-api`) over Postgres — it applies its migrations on boot and serves one
generic HTTP surface for every object type — plus a vanilla-TypeScript console (`web/`) built on the
sibling **amenan-ui** framework. There is no per-type backend code and no frontend framework; the
[layer walk in DOCMAP.md](DOCMAP.md) is the map of the whole thing.

## Prerequisites

| tool | version used here | notes |
|---|---|---|
| Rust (cargo) | 1.98-nightly | stable works too; the workspace pins nothing exotic |
| Node | v24 (≥ 18) | for the console build + the pure-module tests |
| PostgreSQL | 18 (≥ 14) | a local server you can create throwaway DBs on |
| the **amenan-ui** sibling checkout | — | the console's framework, aliased at build (there is **no npm package**) |

**The sibling checkout is not optional.** The console build resolves the bare `amenan-ui` import to
a sibling source tree, expected at `../amenan-ui` relative to the numu repo
(`AMU=../../amenan-ui` from `tools/`). Confirm it before anything else:

```bash
cd /home/mansa/rust-project/numu
ls ../../amenan-ui/src/index.ts     # must exist — the build aborts with a clear error otherwise
```

## 1 · A database

numu applies migrations on boot; you just need an empty database it can own.

```bash
createdb numu_dev
# or on a non-default port: createdb -p 5433 numu_dev
```

## 2 · Boot the backend

The **debug** build includes `/auth/dev-login` (a local escape hatch that is compiled *out* of
release — production uses OAuth). Point it at your database and pick a bind address:

```bash
DATABASE_URL='postgres://localhost/numu_dev' \
NUMU_BIND='127.0.0.1:8099' \
NUMU_DEBUG=1 \
cargo run --bin numu-api
```

Migrations run automatically (idempotent — safe to restart). It's up when the health probes answer:

```bash
curl -s http://127.0.0.1:8099/healthz    # → {"status":"ok","version":"0.1.0"}
curl -s http://127.0.0.1:8099/readyz     # → {"status":"ready","version":"0.1.0"}
```

> The default `NUMU_BIND` is `127.0.0.1:8080`; numu exits with `AddrInUse` rather than clobber a
> port in use, so set your own if 8080 is taken. Full env table: [`api/RUNNING.md`](api/RUNNING.md).

## 3 · Your first requests (a taste of the surface)

The session is a cookie, so keep a cookie jar. Sign in with the seeded dev admin, then create and
read a project — a **real** `PRJ_` entity in the database:

```bash
J=/tmp/numu.cookies
curl -s -c $J -b $J -X POST http://127.0.0.1:8099/auth/dev-login -H 'content-type: application/json' -d '{}'
#   → {"actor_id":"USR_dev"}

curl -s -c $J -b $J -X POST http://127.0.0.1:8099/api/objects/project \
  -H 'content-type: application/json' -d '{"name":"Hello numu","slug":"hello"}'
#   → {"id":"PRJ_…","type":"project","data":{…,"status":"planning"},"version":1,"etag":"W/\"1\""}

curl -s -b $J 'http://127.0.0.1:8099/api/objects/project'
#   → {"items":[{"id":"PRJ_…",…}],"limit":50,"offset":0}   (reach-filtered)
```

Every route with real captured request/response bodies is [`api/ROUTES.md`](api/ROUTES.md); the verb
rules are [`api/HTTP.md`](api/HTTP.md).

## 4 · Boot the console

In a second terminal, build the bundle then serve it (the dev server proxies `/api` and `/auth` to
the backend so the session cookie stays same-origin):

```bash
cd /home/mansa/rust-project/numu
npm install            # first time only
npm run build          # → built: app.js …K · tokens.css …K   (needs the amenan-ui sibling)
NUMU_URL=http://127.0.0.1:8099 npm run dev
#   → serving web/ on http://localhost:8940  (proxying /api,/auth to NUMU_URL)
```

Open **http://localhost:8940**. Sign in, and you land in the console: the Object Rail on the left,
the conversation feed in the middle, the Context panel on the right, and the nacl composer docked
underneath. What to do next is [`frontend/USING-THE-CONSOLE.md`](frontend/USING-THE-CONSOLE.md).

> **Phase-A note.** Served today, the console runs the design project's in-browser sim behind the
> `NumuClient` seam (no backend needed to click around); the Rust api is phase B. `?http=1` on the
> URL flips the same page onto the HTTP driver. The seam contract is
> [`frontend/SEAM.md`](frontend/SEAM.md).

## 5 · Your first nacl commands

In the composer, talk to your data. A worked session (upload → clean → chart) is
[`nacl/TUTORIAL.md`](nacl/TUTORIAL.md); the whole verb surface is
[`nacl/REFERENCE.md`](nacl/REFERENCE.md). A taste:

```
read:project                 # list your projects as an objectTable block
new:case.title="First case"  # INSERT a real CAS_ entity — opens in the Context panel
set:theme.mode=dark          # an effect — the appearance switches
```

## 6 · Verify your setup is sound

```bash
bash tools/ci.sh             # the immune system — bash, never sh
```

`fmt · clippy · test · web-build · web-test` and the audit gates should be green. The **db** gate
runs only when `DATABASE_URL` is set (so a bare clone stays green); set it — pointed at a
**throwaway** DB — to exercise the integration suite. The full gate registry is
[`../tools/README.md`](../tools/README.md); the working rules are [`../CLAUDE.md`](../CLAUDE.md).

## Troubleshooting

| symptom | fix |
|---|---|
| `AddrInUse` on boot | another process owns `NUMU_BIND` — set it to a free port (e.g. `127.0.0.1:8099`) |
| `missing sibling amenan-ui at …` on `npm run build` | clone/checkout amenan-ui at `../amenan-ui`, or set `AMU=/path/to/amenan-ui` |
| console loads but `/api` calls fail | boot the backend first and pass `NUMU_URL` to `npm run dev` so the proxy has a target |
| `POST /api/objects/foo` → `404` | `foo` isn't a registered type — `GET /api/types` lists the catalog ([type-registry skill](../.claude/skills/type-registry/SKILL.md) to add one) |
| a write returns `428`/`412` | writes need `If-Match: W/"<version>"`; `428` = you omitted it, `412` = your version is stale ([`api/HTTP.md`](api/HTTP.md) §3) |
| release build refuses to boot | `NUMU_SECRET` is unset or the dev literal — required in release ([`api/AUTH.md`](api/AUTH.md) §4) |

## Next steps

- **Use the console** → [`frontend/USING-THE-CONSOLE.md`](frontend/USING-THE-CONSOLE.md)
- **Learn nacl** → [`nacl/TUTORIAL.md`](nacl/TUTORIAL.md)
- **Build on numu** (register a type, confine an agent, read the audit) →
  [`foundation/BUILDING-ON-NUMU.md`](foundation/BUILDING-ON-NUMU.md)
- **The whole map** → [`DOCMAP.md`](DOCMAP.md)

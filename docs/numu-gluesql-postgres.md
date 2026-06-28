# numu — data organization: GlueSQL vs Postgres

> **STATUS (2026-06-28): the Postgres/server side is LIVE in numu.** The registry metadata + the
> `project_files` typed projection + the `project_steps` recipe + the immutable on-disk blob all ship
> (`migration 0017`, `pipeline::upload_csv`). GlueSQL (the in-browser, ephemeral client store) stays the
> frontend's job. See [ADR 0001](decisions/0001-data-app-catalog.md).

> **Purpose.** How tabular data is split between **Postgres** (server-side metadata + registry) and
> **GlueSQL** (in-browser, on-device data). This is redpash-rust-pwa's shipped data plane, documented as the
> model **numu inherits** when it takes on data objects (`file`/`chart`/`dashboard`). numu has no
> file/data objects today; this is the design to carry forward.
>
> **Sources (redpash-rust-pwa):** `frontend-dist/wasm-src/gluesql/src/lib.rs`,
> `backend/crates/api/src/pipeline.rs`, `backend/crates/data/src/{steps,wasm}.rs`,
> `backend/migrations/*.sql`, `docs/decisions/day-one.md` (the "derive, don't store" rule).
> **Companions:** [numu-objects-schema.md](numu-objects-schema.md) · [numu-csv-flow-and-datatypes.md](numu-csv-flow-and-datatypes.md).

---

## 1. The principle

> **Postgres holds *metadata about* the data. GlueSQL holds *the data itself*. The original bytes live as an
> immutable blob on disk. The visible frame is *derived*, never stored.**

Three storage tiers, each with one job:

| Tier | What | Where | Lifetime |
|---|---|---|---|
| **Postgres** | object registry + RBAC + audit + **file metadata** + the **step pipeline** | server | durable |
| **Disk blob** | the original uploaded CSV bytes, immutable | server (`data_dir/files/<FIL>.bin`) | durable |
| **GlueSQL** | the actual cell data as a queryable SQL table | **browser** (wasm + IndexedDB) | **ephemeral, per-user** |

The cell data of a dataset **never lands in a Postgres column.** "No customer data in Postgres" holds *by
construction* — `project_files` has a `storage_path`, not a `bytes` column; `columns_meta` carries only
**summary metadata** (dtypes, null %, a sample value), not the rows. The rows live (a) immutably on disk as
the original blob and (b) ephemerally in the user's browser GlueSQL store.

---

## 2. What lives where

| Concern | **Postgres** (server) | **GlueSQL** (browser) |
|---|---|---|
| Object registry | `type_definitions`, `type_fields`, `entities`, `entity_data` | — |
| File metadata | `project_files` (filename, row/col count, cleanness_pct, encoding, **`columns_meta` jsonb**, spec, flags) | — |
| Cleaning pipeline | `project_steps` (ordinal · kind · params · cleanness) — the **step list**, not the data | — |
| Original bytes | disk blob `files/<FIL>.bin` (immutable) | — |
| **The cell data** | — | per-user IndexedDB table `CREATE TABLE <name> (col TEXT, …)` |
| RBAC / audit / settings | memberships, field_permissions, events, settings, … | — |
| Identity isolation | one DB, RBAC-scoped | **one IndexedDB namespace per user** |

GlueSQL is shipped *beside* the Polars engine (`data.js`): **Polars computes, GlueSQL persists + serves
queries on the device** (`gluesql/src/lib.rs` header). Tables are TEXT-only in v1 (numeric typing — passing
the Polars-inferred dtypes through — is a noted future refinement).

---

## 3. Lifecycle / data-flow

```
            ┌─────────────────────────── SERVER (Postgres + disk) ───────────────────────────┐
 upload CSV │                                                                                 │
 ──────────▶│  pipeline::upload_csv  (the ONE write path; insert_file is module-private)      │
            │     1. RBAC: caller ≥ Member on project        → leak-free 404 on denial         │
            │     2. write bytes ──────────────▶  disk:  files/<FIL>.bin   (immutable blob)    │
            │     3. parse + summarize + score  (Polars, off-thread)                           │
            │     4. INSERT project_files   (metadata + columns_meta jsonb)                     │
            │        INSERT project_steps   (ordinal 0, kind='original', baseline cleanness)    │
            │     5. return UploadOutcome { rid, columns[], cleanness, frame, … }               │
            └───────────────────────────────────┬─────────────────────────────────────────────┘
                                                 │  frame + columns
                                                 ▼
            ┌─────────────────────────── BROWSER (Studio + GlueSQL) ──────────────────────────┐
            │  • render the frame in the data table                                            │
            │  • user cleans → each edit is a STEP                                              │
            │       └─ persisted to project_steps (Postgres);  params jsonb, NOT the data       │
            │  • VISIBLE FRAME is re-derived:  data::steps::replay(base_blob, applied_steps)     │
            │  • ingest_csv(namespace=user, table=<name>, csv)  → GlueSQL TEXT table            │
            │       └─ DROP+CREATE+batched INSERT (500/batch);  client-side SQL via query()      │
            │  • logout → IndexedDB cleared (the cell data is gone; the blob + steps remain)    │
            └─────────────────────────────────────────────────────────────────────────────────┘
```

**Re-derive, never store the result.** A cleaning edit appends a `project_steps` row (`kind` + `params`); the
frame shown is always `replay(original_blob, [step₀ … stepₙ])`. There is no "cleaned bytes" column — that
would be a second storage path for one concept (a day-one bug). The score trajectory rides on each step's
`cleanness`.

---

## 4. Cross-layer reference

- **Key mapping:** a Postgres `project_files.redpash_id` (`FIL_…`) ↔ a GlueSQL **table name** (the
  sanitized filename / id token). The browser ingests the file's CSV into a table it can query; Postgres
  never sees that table.
- **Types vs values:** `project_files.columns_meta` (jsonb) carries the **dtype catalog**
  (`ColumnMeta[]` = name, dtype, semantic_dtype, null_pct, unique_pct, sample). GlueSQL stores every column
  as **TEXT** — so type *information* lives in Postgres metadata; type *values* are reconstructed client-side
  from `columns_meta` when needed.
- **The GlueSQL API** (`ingest_csv` / `query` / `drop_table`, all async wasm): per-user namespace
  (`IdbStorage::new(Some(namespace))`), identifiers restricted to `[A-Za-z0-9_]`, values single-quote-escaped
  — arbitrary CSV cells are never interpolated raw into SQL.

---

## 5. What numu inherits / must build

numu's registry today has **no `file`/`chart`/`dashboard` objects and no data crate** — it is the
build-engine. To become the data backend-office:

- Adopt the **three-tier split** above: registry/metadata in Postgres, immutable blob on disk, ephemeral data
  in the client (GlueSQL or equivalent).
- Bring over the **one-write-path seal** (`pipeline::upload_csv` is the only file inserter; `insert_file` is
  private) so every producer inherits RBAC + scoring — no bypass.
- Bring over **derive-don't-store**: `project_steps` + `replay()` rather than storing cleaned data.
- Decide the **client store** for the new numu frontend: GlueSQL-in-browser keeps "data never leaves the
  device" (a strong selling point for client websites) but is ephemeral per session; a server-side store
  would trade that for persistence/sharing.

---

## 6. Planning notes

- **For client websites**, the published surface (charts/dashboards via `spec`, `is_public` files) reads from
  Postgres metadata + the rendered config — *not* from a user's ephemeral GlueSQL store. Plan a persistence
  path for anything that must survive logout or be shared (today, only the original blob + steps persist).
- **Typed GlueSQL** is the noted next refinement (pass Polars dtypes from `columns_meta` into the `CREATE
  TABLE` instead of all-TEXT) — relevant if the front needs numeric sort/filter pushed into client SQL.
- **Connector data** lands the same way as an upload: the server returns CSV bytes, the client ingests them
  into GlueSQL (see [numu-csv-flow-and-datatypes.md](numu-csv-flow-and-datatypes.md) §6).
- **Operators can't reach data through the device.** GlueSQL is **per-user and ephemeral** — a numu operator
  supporting a customer does **not** have that customer's IndexedDB store. So for the backend-office use case
  the device-resident data is structurally unreachable; an operator inspecting customer data necessarily
  **re-derives it server-side** from the immutable blob + `project_steps` (`replay()`). That server-side
  replay is the **real operator data surface** — and exactly what the proposed `access_audit` must cover
  ([numu-rbac-membership-design.md](numu-rbac-membership-design.md) §3.4/§3.7). "Data stays on device" is a
  privacy win for *end-users*; it does **not** weaken operator accountability.

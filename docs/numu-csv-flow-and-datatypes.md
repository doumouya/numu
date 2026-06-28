# numu — CSV ingest flow & datatypes

> **STATUS (2026-06-28): the upload path is LIVE in numu.** The typing engine ported to `crates/{data,shared}`
> (stock polars 0.54), `pipeline::upload_csv` + `POST /api/files` (`UploadOutcome`) shipped, `project_files`/
> `project_steps` in `migration 0017`. The `csv-loader-zero-row-gap` bug is fixed (both `Ok(0 rows)` and the
> unbalanced-quote parse-`Err`). Connector ingest is still deferred. See [ADR 0001](decisions/0001-data-app-catalog.md).

> **Purpose.** What happens when tabular data enters the system (an upload button or a connector) and the
> **exact set of datatypes** a column can receive. Written so the front + new objects can plan against the
> real type vocabulary. This is redpash-rust-pwa's shipped pipeline, documented as numu's go-forward data
> ingest.
>
> **Sources (redpash-rust-pwa `backend/`):** `crates/data/src/dtype.rs`, `crates/data/src/sentinels.rs`,
> `crates/data/src/parse/{mod,sniff}.rs`, `crates/data/src/encoding.rs`, `crates/data/src/stats.rs`,
> `crates/shared/src/file.rs` (`ColumnMeta`), `crates/api/src/pipeline.rs`,
> `crates/api/src/{mysql_loader,connectors_core}.rs`.
> **Companions:** [numu-objects-schema.md](numu-objects-schema.md) · [numu-gluesql-postgres.md](numu-gluesql-postgres.md).

---

## 1. Two ways data enters

| Path | Trigger | Route | Typing |
|---|---|---|---|
| **Upload button** | user picks a file | `POST /api/files` (multipart: `file`, `project`, optional `tld`) → `pipeline::upload_csv` | Polars infers, then the semantic sniff (below) |
| **Connector** | configured external source | `connectors` / `connector_jobs` (kinds `postgres`/`mysql`/`kafka`), SSRF/TLS-gated | native SQL type → **CAST to text** → CSV → re-parsed **identically to an upload** |

Both converge on **the same parse + summarize**: a connector pulls rows, projects every column to text, emits
RFC-4180 CSV bytes, and the client ingests those bytes exactly like an uploaded file. So **the datatype
catalog below applies to both paths.** The connector path adds no server-side column metadata of its own.

---

## 2. The parse pipeline (upload)

`pipeline::upload_csv` runs (RBAC → blob → parse) off the async runtime:

1. **RBAC** — caller needs ≥ Member write-reach on the project (admin bypasses); denial is a leak-free 404.
2. **Persist bytes** — write to `files/<FIL>.bin` *before* the DB row (orphan-blob guard cleans up on failure).
3. **Parse** — `data::parse::from_csv_bytes(bytes, tld)`:
   - **Encoding** (`encoding.rs`) — BOM sniff (UTF-8 / UTF-16LE / UTF-16BE), else `chardetng` with an optional
     2-letter `tld` hint (e.g. `fr`) to disambiguate single-byte codecs (windows-1252 / iso-8859-1). Returns
     the encoding name (stored on `project_files.encoding`).
   - **Delimiter / format sniff** (`parse/sniff.rs`) — normalize line endings; quote-aware two-pass detection
     over the first ~15 lines across `, ; \t |`; a wrapped single-column file (every line a quoted blob) is
     parsed line-literally to preserve unbalanced quotes.
   - **Read** — Polars `CsvReadOptions`: header on, `infer_schema_length = 1024`, `ignore_errors = true` (a bad
     cell becomes null rather than rejecting the file), `truncate_ragged_lines = true`.
4. **Summarize** — `data::dtype::summarize(df)` → one `ColumnMeta` per column (§3–4).
5. **Score** — `data::stats::cleanness(df, cols, &[])` (§5).
6. **Persist metadata** — `INSERT project_files` (incl. `columns_meta` jsonb) + genesis `project_steps`
   (`ordinal 0, kind='original'`), one transaction.

---

## 3. Datatype catalog — the heart

Two type axes per column, **same 6-value vocabulary** for both: `int · float · bool · date · string · empty`.

> **Key assumption — detection is FR-first.** The sniff recognizes FR booleans (oui/non/vrai/faux), day-first
> & 2-digit-year dates, and FR-decimal/`€`-prefixed numbers (`1 234,56`); the upload `tld` hint drives
> encoding disambiguation (§2). Plan for this when onboarding non-FR client datasets — see §7.

### 3.1 Storage dtype (`dtype`) — what Polars parsed
`dtype.rs :: storage_dtype_name(&DataType)`:

| Value | Polars source |
|---|---|
| `int` | any integer type (`is_integer()`) |
| `float` | any float type (`is_float()`) |
| `bool` | `Boolean` |
| `date` | `Date` **or** `Datetime(_, _)` (unified) |
| `string` | `String` (and any unknown type — fallback) |
| `empty` | `Null` (a column with no parsed values) |

### 3.2 Semantic dtype (`semantic_dtype`) — what the column *intends* to be
`dtype.rs :: sniff_semantic_type(&Series)`. If Polars already typed the column non-string, the semantic type =
the storage type. For a **string** column it samples up to **50** non-null, **non-sentinel** cells (trimmed,
lowercased) and requires **≥ 80% agreement** on a shape, in this order:

1. **bool** — ≥80% of samples are bool-words **and** at least one is *non-numeric* (so a bare `0/1`-only
   column stays numeric, not bool).
   - `BOOL_WORDS` = `true false yes no y n t f oui non vrai faux o 0 1` (FR + EN). The bare-`0`/`1` veto uses
     the non-numeric subset (drops `o`/`0`/`1`).
2. **date** — ≥80% are date-shaped (`looks_date_shaped`): an 8-digit `YYYYMMDD`, **or** three
   `/ - .`-separated all-digit groups each ≤4 chars (D/M/Y or M/D/Y).
3. **float** — ≥80% are "numeric-ish" (`looks_numeric_ish`): first char is a digit / `+ - .` / `€ $ £` **and**
   ≥50% of chars are digits (catches dirty numbers like `€995,83`, `1 234,56`, `1000 EUR`). **Two vetoes →
   stays `string`:**
   - **ID-name veto** — the column name contains an id-ish token: `postcode postal zip zipcode siren siret
     tva phone telephone mobile fax iban bic swift id uid guid uuid ssn code ref`.
   - **leading-zero veto** — any sample is a multi-digit all-digit string starting `0` (postal codes
     `07920`, `01000`) — casting to a number would strip meaning.
4. **string** — fails all of the above (the safe default). `empty` only for a Polars `Null` column.

> **There is no email / url / phone / currency / percentage / category semantic type today** — the vocabulary
> is deliberately the 6 above. See [§7](#7-planning-notes) for the extension point.

### 3.3 Sentinels — "missing disguised as a value"
`sentinels.rs :: is_sentinel` (trim + lowercase, then membership). Skipped when sampling for the sniff, and
docked by the cleanness scorer. One unified list (EN + FR + Excel errors):

```
""(blank)  n/a na n.a. - -- — – ? ?? ??? null (null) <null> none nan nil . .. tbd tba x
unknown undefined missing (blank) blank
inconnu n/d nd n.d. "non disponible" "non communiqué" s/o s.o. n.c. "sans objet"
#n/a #name? #ref! #value! #div/0! #num! #null!
```

### 3.4 Per-column metadata — `ColumnMeta` (`shared/src/file.rs`)
Serialized as the `project_files.columns_meta` jsonb array:

| Field | Type | Meaning |
|---|---|---|
| `name` | string | column header |
| `dtype` | string | storage dtype (§3.1) |
| `semantic_dtype` | string | intended dtype (§3.2); defaults `string` for legacy rows |
| `null_pct` | float? | `100 × nulls / rows` |
| `unique_pct` | float? | `100 × distinct / rows` |
| `sample` | string? | first non-null value, original casing |

> **Privacy note.** `sample` is the **one PII-bearing cell** that reaches the registry (an actual customer
> value) — the accepted **F-J** exception, with at-rest encryption pending
> ([legal](numu-legal-privacy-data-compliance.md) §3.4, [gluesql](numu-gluesql-postgres.md) §2). Uploaded CSVs
> "routinely carry third-party PII," so a column's privacy class matters here, not just its dtype.

### 3.5 User-facing casts (the cleaner)
A user can *re-type* a column via cleaning steps; the cast targets are the same vocabulary:
`str · int · float · bool · date` (plus a dedicated `format_dates` step with a format picker — FR-first,
day-first / 2-digit-year aware). The drift detectors in `dtype.rs` (`worst_type_drift`, `worst_date_drift`)
surface the silent "mostly one type" (50–95%) band and mixed dd/mm-vs-mm/dd date contradictions.

---

## 4. The upload response (`UploadOutcome`)

What the upload route returns to the front (the `frame` field of the Rust struct is cached server-side, not
serialized):

```jsonc
{
  "rid": "FIL_9f3a…",          // the file object id
  "filename": "clients-fr",    // upload extension stripped
  "encoding": "windows-1252",  // detected
  "cleanness": 87.5,           // 0–100 quality score
  "fully_null_rows": 0,
  "size_bytes": 10241,
  "columns": [
    { "name": "id",          "dtype": "int",    "semantic_dtype": "int",    "null_pct": 0.0,  "unique_pct": 100.0, "sample": "1" },
    { "name": "code_postal", "dtype": "string", "semantic_dtype": "string", "null_pct": 0.0,  "unique_pct": 80.0,  "sample": "07920" },
    { "name": "actif",       "dtype": "string", "semantic_dtype": "bool",   "null_pct": 8.3,  "unique_pct": 16.6,  "sample": "oui" }
  ]
}
```

---

## 5. Cleanness score (context for `cleanness_pct`)

`stats::cleanness_report` = **value_quality × structural_integrity** (structural is a *gate*, not an average):

- `value_quality = 0.35·completeness + 0.25·type_consistency + 0.25·value_hygiene + 0.15·row_uniqueness`
- `structural_integrity = min(shape, encoding, header)`

where type_consistency = % of string cells that strict-parse as their column's `semantic_dtype`,
value_hygiene = % of cells with no padding and not a sentinel, shape catches under-parsed single-column files,
encoding catches replacement-char / mojibake, header catches empty/junk headers. The genesis step stores the
baseline; each cleaning step carries its own `cleanness` so the trajectory is queryable.

---

## 6. Connectors (the other ingest path)

`connectors` (kind ∈ `postgres`/`mysql`/`kafka`) + async `connector_jobs`. The MySQL loader
(`mysql_loader.rs`) is the worked example:

- **Gate** (`connectors_core::host_gate`) — block link-local / metadata / unspecified hosts (SSRF); remote
  hosts must use `ssl_mode ≥ Required`; plaintext only for loopback.
- **Pull** — pin the session (utf8mb4, UTC, `NO_ENGINE_SUBSTITUTION`); read `INFORMATION_SCHEMA.COLUMNS` for
  `(name, data_type)`; **type-aware projection** to text (`project_expr`): geometry → `ST_AsText` (EWKT),
  binary/blob → `HEX`, `bit` → unsigned→char, `float` → `DOUBLE`→char, everything else → `CAST … AS CHAR`;
  emit RFC-4180 CSV (quote-escaped, NUL stripped).
- **Result** — CSV bytes, never persisted to Postgres; the client ingests them into GlueSQL and **re-sniffs
  the same semantic types** as an upload. So a connector column's final dtype/semantic_dtype is decided by the
  **same `dtype.rs` logic** — the native SQL type only determines the text projection.

---

## 7. Planning notes

- **The semantic vocabulary is narrow on purpose (6 values).** If the numu frontend / client sites need richer
  column semantics — `email`, `url`, `phone`, `currency`, `percentage`, `category`, `id` — that is an
  extension of **two** places: `sniff_semantic_type` (add detectors, in precedence order, with sentinel +
  veto handling) and the `ColumnMeta.semantic_dtype` vocabulary (+ the cleanness scorer's per-semantic strict
  parse). The existing ID-name + leading-zero vetoes show the pattern (don't over-cast meaningful strings).
  **Privacy tie-in:** a richer semantic type that implies personal data (`email`, `phone`, `id`, `ssn`)
  should also map the column to a **`data_class`** ([objects-schema](numu-objects-schema.md) §4,
  [legal](numu-legal-privacy-data-compliance.md) §3.1) so the operator read-audit + export-scoping pick it up.
- **Type info is metadata-side.** GlueSQL stores cells as TEXT (see
  [numu-gluesql-postgres.md](numu-gluesql-postgres.md)); the dtype/semantic_dtype lives in `columns_meta`.
  Richer client-side typed sort/filter means either passing dtypes into the GlueSQL `CREATE TABLE` or typing
  on read from `columns_meta`.
- **Connectors are framework-built, ETL partly deferred.** The gate + MySQL loader exist; the in-request
  connector→file flow is phase-4. New connector kinds inherit the "project to text → re-sniff" model — no new
  typing path needed.
- **Locale matters.** Detection is FR-first (oui/non, day-first dates, `1 234,56`); the `tld` hint on upload
  drives encoding disambiguation. Keep that when planning non-FR client datasets.

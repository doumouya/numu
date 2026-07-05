# 0003 — a proposal minted `REL_` for release, colliding with the relation-edge prefix

The consolidated-app proposals (docs/apps/) gave the **releases** app a `release` object with id
prefix `REL_`. But `REL` is the **live** system prefix for relation edges (`relations.rs`). Reusing
it would have made `kind(id)` ambiguous — the exact failure the day-one rule exists to prevent. This
records the catch and the rename to `RLS_`.

Origin: the data-model reconciliation of the app proposals (CASE 0016 in the apps line; the numu
console-web branch), 2026-07-04. Found by reading the proposals against the id registry, not at
runtime — a design-time catch.

## Symptom

A design-time collision, not a crash: the releases proposal declared

```
| release | REL_ | title · artist ref · date · workflow status |
```

while `crates/api/src/relations.rs` already mints `REL` for every relation edge (the generic
entity↔entity edge). Two types, one prefix.

## Root cause

numu ids are `<PREFIX>_<32-hex>`, and `kind(id)` is a **pure prefix→type lookup** — parsing,
routing, and every polymorphic `memberships`/`relations`/`subject_id` edge rely on the prefix being
unique per type (the day-one rule: *one prefix, one type, forever*). Sharing `REL` between the
relation edge and a `release` type would make `kind("REL_…")` ambiguous — is it an edge or a release?
The predecessor's `FIL_`-shared-between-file-and-dashboard incident is the lineage lesson this rule
carries. The proposal author reached for the obvious three letters of "release" without checking the
system-lane registry.

## Fix

Release mints **`RLS_`** instead; the proposal, the DATA-MODEL adjudication, and the app-registered
prefix table in `object-model/numu_id.md` (now [`../api/IDS.md`](../api/IDS.md)) all use `RLS`. The
Design-project seed's `REL_44` label is flagged as an upstream nit to fix at the next re-sync. The
rule generalizes: before minting a new prefix, check it against **all four** lanes — live registry,
planned catalog, app-registered, and the system lanes (`SES REL FRN st req`).

## Verify

`kind(id)` stays unambiguous: `grep` the id registry for the prefix before adopting it.

```bash
grep -RnE '\bREL\b|\bRLS\b' ../object-model/numu_id.md docs/api/IDS.md   # REL = edge, RLS = release, disjoint
```

The standing guard is the registry itself ([`../api/IDS.md`](../api/IDS.md)): a new type's prefix is
checked against every lane there before it's minted. `POST /api/types` also rejects a taken
`id_prefix` with `409` at runtime (the DB `UNIQUE` backstops it), so a collision can't silently land.

## Related

The id contract, the day-one rule, and the four prefix lanes: [`../api/IDS.md`](../api/IDS.md). The
app proposals that surfaced this: [`../apps/DATA-MODEL.md`](../apps/DATA-MODEL.md).

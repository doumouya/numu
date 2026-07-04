#!/usr/bin/env bash
# data-class-audit — the classification gate (docs/kernel/GOVERNANCE.md §Implementation #1). Read-only
# static check over the seed SQL + types.rs. Enforcement is LAYERED and this gate targets the seams the DB
# can't:
#   • the DB does the floor — `type_fields.data_class` is NOT NULL DEFAULT 'internal' + CHECK-constrained,
#     so every field is validly classified to at least the floor at migration time (R1 asserts the guard
#     exists so it can't be dropped);
#   • the type-registration validator classifies runtime-registered types too (R2);
#   • THIS gate lints the one thing neither can judge: a PII-named field left at/ below the floor instead of
#     being RAISED to personal|sensitive — inline in its seed row OR via a `set data_class=...` manifest (R3).
# v0 is grep/awk (under-claims, never false-positives); a real SQL parser is a follow-on. Exits 0 (clean/
# dormant) or 1 (+ a FINDING list). Auto-discovered by tools/ci.sh's tools/*-audit loop — no ci.sh edit.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

CLASSES='public|internal|personal|sensitive'
# PII field-name heuristic — a conservative FLOOR (tune as the domain grows). Deliberately EXCLUDES bare
# name/title/slug (routinely non-personal in a build engine); matches the unambiguous identifiers.
PII='email|e_mail|phone|mobile|msisdn|dob|birth|ssn|sin|nino|passport|national_id|address|postal|postcode|zip|tax_id|vat|iban|bic|swift|card_no|cardnum|cvv|full_name|first_name|last_name|given_name|surname|maiden|latitude|longitude|geo|ip_addr|device_id'

# ── R0 · dormancy — the gate arms WITH the slice ────────────────────────────────
# Until a migration introduces type_fields.data_class there is nothing to classify against: stay green so
# this gate can land alongside GOVERNANCE.md and self-arm the moment the column appears.
if ! grep -Rql 'data_class' migrations 2>/dev/null; then
  echo "  data-class-audit: dormant (type_fields.data_class not yet in schema) — arms with the #1 slice"
  exit 0
fi

# ── R1 · schema backstop — the column is NOT NULL and vocab-constrained (CHECK or enum type) ──────
grep -REiq 'data_class[^,;]*not[[:space:]]+null' migrations \
  || flag schema-notnull "type_fields.data_class must be NOT NULL (the DB floors every field to a class)"
if ! grep -REiq 'data_class[^;]*(check|[[:space:]]in[[:space:]]*\()' migrations \
   && ! grep -REiq 'create[[:space:]]+type[[:space:]]+data_class[[:space:]]+as[[:space:]]+enum' migrations; then
  flag schema-check "type_fields.data_class needs a CHECK/enum restricting it to ($CLASSES)"
fi

# ── R2 · API backstop — the runtime type-registration validator classifies too ─────────────────
if [ -f crates/api/src/types.rs ]; then
  grep -q 'data_class' crates/api/src/types.rs \
    || flag validator "types.rs (POST /api/types) does not handle data_class — a runtime-registered field would skip classification"
fi

# ── R3 · PII-raise lint — a PII-named field must be raised to personal|sensitive ────────────────
# A field is "raised" if it is set personal|sensitive either INLINE in its seed row or via a
# `update type_fields set data_class = 'personal'|'sensitive' where (type_id, field) in ((...))` manifest.
# Keyed by type.field, so a raise in a later migration (e.g. 0016) counts for a field seeded earlier.
# \x27 = single quote; options JSON uses DOUBLE quotes inside its single-quoted blob, so a bare '<class>'
# token can't collide with an enum option value.
scan=$(awk -v PII="$PII" '
  # the raise manifest (an UPDATE that sets data_class to personal|sensitive)
  /update[[:space:]]+type_fields[[:space:]]+set[[:space:]]+data_class[[:space:]]*=[[:space:]]*.(personal|sensitive)./ { inupd = 1 }
  inupd && /^[[:space:]]*\(/ { split($0, a, "\x27"); raised[a[2] "." a[4]] = 1 }
  inupd && /;[[:space:]]*$/ { inupd = 0 }

  # the seed inserts — collect PII candidates; honor an inline personal|sensitive token as a raise
  /insert into type_fields/ { inblk = 1; next }
  inblk && /^[[:space:]]*\(/ {
    split($0, a, "\x27"); t = a[2]; fld = a[4];
    if ($0 ~ "\x27(personal|sensitive)\x27") raised[t "." fld] = 1;
    if (fld ~ ("(" PII ")")) { key = t "." fld; cand[key] = 1; loc[key] = FILENAME ":" FNR }
  }
  inblk && /;[[:space:]]*$/ { inblk = 0 }

  END { for (k in cand) if (!(k in raised)) printf "underclass\t%s\t%s\n", k, loc[k] }
' migrations/*.sql)

if [ -n "$scan" ]; then
  while IFS=$'\t' read -r rule what where; do
    [ -z "${rule:-}" ] && continue
    flag pii-underclass "PII-named field $what is not raised to personal/sensitive ($where)"
  done <<< "$scan"
fi

if [ "$findings" -eq 0 ]; then
  echo "  data-class-audit: clean (0 findings)"
  exit 0
else
  echo "  data-class-audit: $findings finding(s) — see docs/kernel/GOVERNANCE.md §Implementation #1"
  exit 1
fi

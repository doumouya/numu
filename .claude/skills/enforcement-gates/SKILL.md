---
name: enforcement-gates
description: >-
  Use when you want a rule to be ENFORCED rather than remembered — adding a CI check, encoding a recurring
  fix so it can't regress, making an invariant un-bypassable, or authoring/extending a `tools/*-audit`. This
  is numu's identity: its disciplines are QUERIES, not prompts — git/DB-enforced, harness-agnostic, so
  drift fails the tool, not the user ("this is how we survive"). Reach for this whenever you catch yourself
  writing "remember to…", "always…", or "the reviewer should check…" in docs or a commit message — that
  sentence wants to be an audit. Also when an invariant matters enough that a *direct DB write* must not be
  able to break it (the Rust-gate + DB-backstop doubling). Covers authoring a `tools/<name>-audit/audit.sh`
  (scan- and git-based), how `ci.sh` auto-discovers it, the ratchet, and `NUMU_CI_STRICT`. NOT for the
  specific rules already shipped — those live in the rbac / api-conventions skills.
---

# enforcement-gates — a discipline you can't run is a discipline you don't have

A convention written in a doc decays the moment someone's in a hurry. A convention written as a **query
that fails CI** can't. numu turns its rules into two un-bypassable shapes:

1. **A static audit** — a `tools/<name>-audit/audit.sh` that greps the source or inspects the last commit
   and exits non-zero on a violation. `ci.sh` runs every one.
2. **A Rust-gate + DB-backstop pair** — for an invariant a *direct* DB write could otherwise break: enforce
   it in the handler **and** as a trigger/constraint that raises a tagged error mapping back to a precise
   HTTP status.

> The spine is documented in [`tools/README.md`](../../../tools/README.md). This skill is how to *add* a
> gate. The rules already enforced are spec'd in the **rbac** and **api-conventions** skills.

## Part 1 — author a static audit

### The harness (copy this)
`ci.sh` ([`tools/ci.sh`](../../../tools/ci.sh)) runs, in order: **fmt → clippy → test → db** (conditional on
`DATABASE_URL`) **→ every `tools/*-audit/audit.sh`**. The audit loop is literally:

```bash
for a in tools/*-audit/audit.sh; do
  [ -e "$a" ] || continue
  gate "$(basename "$(dirname "$a")")" bash "$a"
done
```

So **a new gate is a new directory** — drop `tools/<name>-audit/audit.sh`, make it executable, and it runs.
**No `ci.sh` edit.** Every audit shares one contract: exit `0` clean, exit `1` after printing
`FINDING [rule] message` lines. Scaffold:

```bash
#!/usr/bin/env bash
# <name>-audit — <the discipline, in one line>. Run by ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."          # repo root
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

# ── your checks here: each violation calls `flag <rule> <message>` ──

if [ "$findings" -eq 0 ]; then
  echo "  <name>-audit: clean (0 findings)"; exit 0
else
  echo "  <name>-audit: $findings finding(s)"; exit 1
fi
```

Two real flavours to model on:

**Scan-based** (grep/awk over source — like `debuggability-audit`, `rbac-audit`): assert a property of the
code. Example shape:
```bash
# every handler that touches entity data must gate via require_action
while IFS= read -r f; do
  grep -q 'require_action\|require_rank' "$f" || flag R1 "handler $f reads entity data without an RBAC gate"
done < <(grep -rl 'entity_data' crates/api/src/*.rs)
```

**Git-based** (inspect the last commit — like `case-first-audit`, `docs-currency-audit`): assert a property
of *the change*. Example shape:
```bash
files=$(git show --name-only --format= HEAD)
code=$(printf '%s\n' "$files" | grep -E '^(crates/|migrations/)' || true)
docs=$(printf '%s\n' "$files" | grep -E '^docs/' || true)
[ -n "$code" ] && [ -z "$docs" ] && flag docs-currency "code changed without touching docs/ (or a 'Docs: n/a' note)"
```
Git-based audits check **HEAD** (one-commit lag) — fine for numu's direct-to-main flow. Always guard with
`git rev-parse HEAD >/dev/null 2>&1 || exit 0` so a fresh clone with no history stays green.

### Design rules (so the gate helps instead of nagging)
- **Read-only.** An audit analyses; it never mutates the repo. (`tools/README.md` makes this a convention.)
- **Name your rules.** `flag <rule-id> <message>` — the id (R1, R2, …) lets a reader map a finding to the
  documented reason. Put the reasons in a doc the message can point at.
- **A finding must be actionable and true.** A noisy or false-positive audit gets ignored, then disabled —
  worse than no audit. If it's flagging correct code, fix the *query*, don't loosen the rule. (This is the
  numu "refine the algo, don't work around it" reflex.)
- **Zero findings = green, today.** The tree starts clean so any finding is a real regression.

### The ratchet (when the tree isn't clean — follow-on)
Once a real codebase carries known/triaged findings, an audit can diff against a committed `baseline.json`
and fail only on **new** violations (the pattern proven in the sibling build-engine). Until then v0 keeps it
binary. When you build the ratchet, log what was baselined — a silently-grandfathered finding reads as
"clean" when it isn't.

### `NUMU_CI_STRICT` — a skip is a hole
`ci.sh`'s `skip()` (missing fmt/clippy, or `DATABASE_URL` unset) prints a notice locally but, under
`NUMU_CI_STRICT=1` (set it in real CI), becomes a **failure**. A green run that skipped half its gates isn't
green — strict mode makes that impossible to miss.

## Part 2 — the Rust-gate + DB-backstop doubling

A handler gate protects the *HTTP path*. It does **not** protect against a direct `UPDATE`, a future
internal writer, or a bug that bypasses the handler. For an invariant that must hold no matter who writes,
enforce it **twice**:

1. **In Rust**, for a clean, specific error on the normal path.
2. **In the database**, as a trigger or constraint that raises a **tagged sqlstate**, which the error layer
   maps back to the *same* precise HTTP status.

### Worked example — the workflow close-gate
**Rust gate** — [`workflow.rs`](../../../crates/api/src/workflow.rs) `validate()` rejects an illegal status
move (`422 illegal_transition`) before the write.

**DB backstop** — [`migrations/0008_cases_guard.sql`](../../../migrations/0008_cases_guard.sql), a
`before update` trigger on `cases` that re-checks the close preconditions and raises a custom sqlstate:

```sql
if unmet > 0 then
  raise exception 'close preconditions unmet for %', new.entity_id using errcode = 'NU001';
end if;
```

**The bridge** — [`error.rs`](../../../crates/api/src/error.rs) maps that sqlstate back to a real status, so
a bypass attempt still returns a clean, correct error instead of a bare 500:

```rust
db.code() == "NU001" => AppError::close_preconditions_unmet("close preconditions not met")  // 422
```

Now a `done` case is honest whether the move comes through the API or a raw SQL `UPDATE`. The same shape
backs RBAC (the Rust `require_action` gate **+** the `rbac-audit` static check) — enforce the rule where the
code runs *and* where the data lives.

### When to reach for it
Double-enforce when **all** hold: the invariant is a correctness/security property (not a nicety); a
violation is hard to detect after the fact; and a writer *other than* the audited handler could plausibly
touch the table. Otherwise the Rust gate alone is enough — don't add a trigger for everything.

## Procedure for a new gate
1. **Write the rule as one sentence.** If you can't, it's not enforceable yet — sharpen it.
2. **Pick the shape:** property of the *code* → scan audit; property of the *change* → git audit; invariant
   a direct write could break → add a DB backstop too.
3. **Author `tools/<name>-audit/audit.sh`** from the scaffold; `chmod +x`; name each rule.
4. **Self-test both ways:** confirm it's clean on a good HEAD, and that it actually `flag`s a planted
   violation (a gate that can't fail is worse than none).
5. **Document the rules** in the governing doc and add a row to `tools/README.md`'s gate table.
6. **Run `bash tools/ci.sh`** — your gate is auto-discovered. If it's a discipline gate for the team, say so
   in `tools/README.md` so the next contributor knows why a finding blocked them.

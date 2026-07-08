# Doc types & templates

> **Status: DRAFT** marker only (strips at install acceptance, CASE 0028 slice 5) — the
> content below is complete. Every exemplar path was verified on disk before being cited.

## The taxonomy — pick the doc type by the question it answers

One doc, one altitude. If you're about to answer a *different* question mid-doc, you're
writing a second doc — link it instead. Live exemplars from Em's repos (WSL paths):

| Type | Answers | Read it when | Live exemplar |
|---|---|---|---|
| **Orientation** (README) | "what is this, why care?" | first contact | `/home/mansa/birama-engine/README.md` |
| **Navigation** (DOCMAP / index) | "where does X live?" | you don't know which doc to open | `/home/mansa/amenan-ui/docs/DOCMAP.md` (tiered index + "read it when" column) |
| **Explanation** (ARCHITECTURE) | "*why* is it shaped this way?" | before extending or judging the design | `/home/mansa/birama-engine/docs/ARCHITECTURE.md` |
| **Reference** | "*what* exactly is the surface?" | you need the exact route/signature/config | `/home/mansa/rust-project/numu/docs/api/ROUTES.md` (captured real examples) · `/home/mansa/amenan-ui/docs/COMPONENTS.md` |
| **How-to / tutorial** | "*how* do I get to outcome X?" | you're doing, not studying | `/home/mansa/rust-project/numu/docs/foundation/BUILDING-ON-NUMU.md` (executed before written) · `/home/mansa/amenan-ui/docs/GETTING-STARTED.md` |
| **Runbook** | "this broke before — how was it closed?" | an incident recurs, or post-fix | `/home/mansa/rust-project/numu/docs/runbooks/0004-docs-currency-same-commit.md` (symptom → root cause → fix → verify) |
| **Decision record** (locked) | "what was decided, and who may change it?" | you're tempted to change a contract | `/home/mansa/rust-project/numu/docs/api/HTTP.md` ("**Locked decision.**" header; Em-level to change) |
| **Glossary / vocabulary** | "what does this term mean *here*?" | terms outnumber intuition | `/home/mansa/rust-project/numu/docs/nacl/REFERENCE.md` §"Type vocabularies" (GENERATED — no standalone hand-written glossary exists in the corpora yet; if one is earned, generate it) |
| **Troubleshooting** | "it doesn't work — now what?" | mid-how-to failure | `/home/mansa/rust-project/numu/docs/GETTING-STARTED.md` §"Troubleshooting" (a *section* of the how-to — the house pattern; incident *history* graduates to runbooks) |

Two deliberate house choices: **troubleshooting rides inside the how-to it serves** (a
standalone troubleshooting doc drifts from the steps it debugs), and **design-contract docs
are a status, not a type** — any type above can be born DRAFT/forward (see status headers).

## Skeletons (repo-agnostic — fill the angle brackets, delete what you don't earn)

### README

```markdown
# <project>

<One paragraph: the problem this solves and for whom — a pitch, not a feature list.>
<The one idea that makes it different, in a sentence or two.>

## Install

    <two lines max: package-manager install, or clone + the one build command>

## Use

    <the single most common case, runnable exactly as pasted>

<the expected output, one or two lines — so the reader knows it worked>

More: <link getting-started> · every doc: <link the docs index>

## Project

- Source & issues: <repo url — where to read code and file bugs>
- Support: <where humans answer questions — discussions / channel / email>
- License: <SPDX id> (see <link LICENSE>)
```

### Reference doc

```markdown
# <area> — reference

> **Status: LIVE.** Describes `<code area>`; code is truth — on disagreement the source
> wins and this file reconciles in the same change. Read it when you need the exact
> <route / signature / config>; the *why* lives in <link the explanation doc>.

## `<unit — one route / component / verb / type>`

- **Shape:** `<signature | METHOD /path | config type>`
- **Behaviour:** <what it does — stated, not narrated>
- **Errors:** <status/variant → when — the failure table>
- **Example:** <one REAL captured call + response — never invented output>

## `<next unit …>`
```

### How-to

```markdown
# <the reader's goal, as a verb phrase>

You want <outcome>. This walks you there from <the assumed starting state>;
every step was executed before it was written.

## Prerequisites

<tool + version> · <access/secrets> · <state assumed present>

## Steps

1. <action> — run: `<exact command>`
   → <what you should see before moving on>
2. <…each step verifiable before the next>

## Verify

<the end-to-end check that proves the outcome, not just the last step>

## Troubleshooting

- <symptom> → <cause> → <fix>  <!-- recurring incidents graduate to a runbook -->
```

## Status headers — the honesty convention

Every doc declares its truth-level, in its opening lines or its DOCMAP status cell
(ideally both; the DOCMAP cell is what the doc-coverage tooling can reach). The house
vocabulary, with live phrasings:

- **LIVE** — describes shipped code; code is truth; a change to the surface reconciles
  this doc *in the same commit* (the docs-currency gate).
- **DRAFT / design contract** — authoritative *until code lands*, and says so explicitly.
  Live phrasing (numu `docs/ops/DATABASE.md`): `> **Status: design contract
  (forward-looking) · current: single-node Postgres on localhost (dev).**` — note it
  states both the aspiration AND the current reality.
- **Locked decision** — owner-level (Em) to change, noted in a Case. Live phrasing
  (numu `docs/api/HTTP.md`): `> **Locked decision.** … Changing anything here is an
  Em-level decision.`
- **GENERATED** — never hand-edit; name the generator and the gate that pins byte-identity
  (numu `docs/nacl/REFERENCE.md`: `> **GENERATED — never hand-edit.**` + doc-coverage R5).

Aspirational *sections* inside a LIVE doc are labelled aspirational/forward inline —
silent wishful prose reads as fact and burns the reader's trust in the whole file.

## The README checklist (Write-the-Docs-derived)

A README is done when a stranger can answer all of these without leaving it:

1. **What problem does this solve, for whom?** (the pitch — first paragraph, no jargon)
2. **What's the one idea?** (what makes it different — one or two sentences)
3. **How do I install it?** (a couple of lines, copy-pasteable)
4. **What does the common case look like?** (ONE small worked example + expected output)
5. **Where's the rest?** (link getting-started + the docs index — link depth, don't inline)
6. **Where's the code, and where do I report a bug?** (source + issue-tracker links)
7. **Where do I get help?** (a named support channel — a human route, not just the tracker)
8. **What license?** (SPDX id + a LICENSE file link)
9. **Is it alive?** (honest status: maintained / alpha / frozen — see status headers)

Items 7 and 8 are the audited gaps in the current corpora — check them first when
refreshing an existing README.

## Why no FAQs

- An FAQ entry is a mini-answer **detached from the doc that owns its topic** — nothing
  anchors it to the code or to the doc that should carry it, so it rots first.
- FAQs grow **append-only** into orphan heaps: nobody deletes a stale Q, nobody reads #23.
- Every genuine FAQ is **evidence a real doc failed to answer** — that's a defect report.
  Fold the answer into the doc that should have answered it (the WTD anti-pattern read).
- Recurring support questions are still gold: they tell you *which* doc is failing.
  Route the signal to the doc; don't build a second, competing home for answers.

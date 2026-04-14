# Work Packages — Family Calendar Evals (Non-Gating)

Status: proposed companion  
Companion to: `docs/PRD/family-calendar-prd.md`  
Last verified: 2026-03-30

## Use this companion when
- implementing or extending family-calendar eval infrastructure
- reviewing fixture-corpus quality and drift-tracking workflows
- planning non-gating quality loops separate from CI correctness tests

## Scope boundary
- This companion is non-gating.
- It does not redefine runtime contracts.
- It does not add CI blocking checks.

## Delivery order

1. WP08 — eval framework and runners
2. WP09 — golden-set initialization
3. WP10 — failure harvesting tooling
4. WP11 — eval reporting and analysis
5. WP12 — observability alignment

---

## WP08 — Eval Framework (Non-Gating)

### Goal
Introduce a top-level eval framework and live runners without changing runtime behavior or CI gates.

### PRD sections
- §22.1 Role and gating boundary
- §22.2 Eval surfaces
- §22.4 Execution model
- §22.6 Reporting outputs

### Scope
- Create top-level `evals/` structure.
- Add fixture schemas for:
  - router stateless
  - router stateful continuation
  - calendar normalization
- Implement live runners:
  - `eval:router:live`
  - `eval:calendar:live`
- Produce JSON + markdown outputs.
- Keep shared runner plumbing in `scripts/evals/lib/runner-common.js` and document add-a-surface flow in `evals/eval-writing-guide.md`.

### Out of scope
- CI integration
- offline mode
- new eval database tables

### Acceptance
- eval commands can run against backend API surfaces
- each run emits JSON + markdown reports

---

## WP09 — Golden Set Initialization

### Goal
Create an initial high-signal fixture corpus.

### PRD sections
- §22.3 Corpus and storage model
- §22.5 Metrics and advisory targets

### Scope
- Router corpus:
  - 50 stateless cases
  - distribution: 20 obvious, 15 ambiguous, 15 adversarial/edge
  - include stateful continuation fixtures as a separate set
- Normalize corpus:
  - 40 cases
  - distribution: 20 clean, 10 clarification, 10 rejection/edge
- Tag fixtures with failure-type metadata.

### Acceptance
- corpus committed under `evals/*/fixtures/gold/`
- fixture counts and bucket minimums are enforced by tooling/tests

---

## WP10 — Failure Harvesting Tooling

### Goal
Make it quick to convert real failures into candidate fixtures.

### PRD sections
- §22.7 Failure-harvesting workflow
- §22.9 Observability integration

### Scope
- Add CLI/script that takes `run_id` and `surface`.
- Pull from debug surfaces and pipeline trace summaries.
- Write candidate fixtures under `fixtures/candidates/`.
- Keep manual promotion to gold as a required human step.

### Acceptance
- given one `run_id`, script can write a candidate fixture file
- output explicitly marks missing expected labels for manual review

---

## WP11 — Eval Reporting And Analysis

### Goal
Make eval output easy to act on.

### PRD sections
- §22.5 Metrics and advisory targets
- §22.6 Reporting outputs

### Scope
- markdown report includes:
  - summary metrics
  - confusion matrix (router)
  - grouped failures
- explicitly highlight:
  - false-positive `calendar_create`
  - bad clarification decisions
  - high-confidence errors

### Acceptance
- single command produces readable report artifacts
- grouped failures are easy to scan and triage

---

## WP12 — Observability Alignment

### Goal
Ensure every eval case is traceable through existing observability.

### PRD sections
- §22.9 Observability integration
- §17 Observability and logging requirements

### Scope
- assign unique `run_id` per eval case
- verify pipeline trace rows exist per case (unless explicitly disabled)
- document eval -> debug trace workflow in `evals/README.md`

### Acceptance
- a failing case can be traced with its `run_id` via debug surfaces
- workflow from failure -> candidate fixture is documented

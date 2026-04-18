# Failure-Pack Codex Script Contract

This document defines how Codex should work the failure-pack surface.

## Required flow

1. Run `scripts/failure/list-open-failures`.
2. Pick one `failure_id`.
3. Run `scripts/failure/get-failure <failure_id>`.
4. If sidecars are present, run `scripts/failure/copy-failure-sidecars <failure_id>`.
5. Prepare analysis text files.
6. Run `scripts/failure/analyze-failure <failure_id> --reason-file <path> --fix-file <path>`.

## Prohibited actions

- direct backend API calls outside the helper scripts
- direct n8n API calls outside the helper scripts
- ad hoc SSH browsing of sidecars outside the helper scripts
- resolving a failure via script (resolve is UI-only in v1)
- attempting code-apply or runtime mutation through this surface

## Script behavior notes

- Scripts use local backend access first when `PKM_ADMIN_SECRET` is available.
- Scripts fall back to webhook transport through `PKM_FAILURE_WEBHOOK_BASE` when that façade is deployed.
- Sidecar copy destination is `.codex/failure-sidecars/<failure_id>/` (gitignored).
- Sidecar copy source defaults to `/home/igasovic/pkm-import` on host `pi`; override with:
  - `PKM_FAILURE_PI_HOST`
  - `PKM_FAILURE_PI_SOURCE_ROOT`

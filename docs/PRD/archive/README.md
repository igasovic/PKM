# PRD Archive

This directory holds historical or completed PRD artifacts that should not be treated as the active owner of a surface.

## Read This Archive When
- an active PRD explicitly points here for historical context
- you are recovering why a major pivot or migration happened
- you need implementation history, not current surface ownership

## Archive Quick Map

| File | Read when |
|---|---|
| `MCP-transition-work-packages-v2.md` | understanding the public MCP -> n8n-first ChatGPT pivot |
| `distill-reference-appendix.md` | active distill PRD points you here for deep reference |
| `failure-pack-work-packages.md` | understanding failure-pack v1 delivery history |
| `n8n-npm-migration.md` | understanding the package-based n8n runtime migration |

## Archive Rules
- Keep a file here when it still helps explain a past migration, pivot, or completed implementation slice.
- Move work-package docs here after the canonical PRD baseline has been updated and the work package is no longer guiding active implementation.
- Do not read archive docs first when planning or implementing a new change unless the active PRD explicitly points here for historical context.

## Archived Artifacts
- `MCP-transition-work-packages-v2.md`
  - historical transition plan for the public MCP -> n8n-first ChatGPT pivot
  - retained because the pivot materially changed the final GPT Actions design
- `failure-pack-work-packages.md`
  - completed v1 implementation work package companion for the failure-pack surface
- `n8n-npm-migration.md`
  - completed migration PRD for the n8n runtime package transition

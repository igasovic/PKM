# Legacy Reference (Deprecated)

This file is no longer the source of truth for working memory.

Canonical working memory now lives in backend active-topic state and is read/written through ChatGPT actions:
- `working_memory(topic)` for reads
- `wrap-commit` for writes

Do not manually edit this file as part of normal operation.

## Phase 1 Active Topic Set
- `communication`
- `parenting`
- `product`
- `ai`

## Operational Notes
- Exactly one active topic should be selected for each wrap/commit cycle.
- Topic state is structured (`why_active_now`, `current_mental_model`, `tensions_uncertainties`, `open_questions`, `action_items`) and rendered to markdown for GPT-facing reads.
- Session notes remain separate artifacts stored through wrap/commit.

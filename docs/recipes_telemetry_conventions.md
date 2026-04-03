# Recipes Telemetry Conventions

## Purpose
- define recipe-specific telemetry naming conventions that align with existing backend patterns
- avoid ad hoc event names for recipe API and DB paths

## Scope
- backend route telemetry (`logApiSuccess` / `logApiError` metadata)
- DB trace event naming (`traceDb` operation keys)
- n8n command parsing and formatter expectations for recipe commands

## Naming conventions

### API operation names
Use `api_recipes_<action>` in route handlers:
- `api_recipes_create`
- `api_recipes_search`
- `api_recipes_get`
- `api_recipes_patch`
- `api_recipes_overwrite`
- `api_recipes_review`

### Logger step names
Use `api.recipes.<action>` for `logger.step(...)` wrappers:
- `api.recipes.create`
- `api.recipes.search`
- `api.recipes.get`
- `api.recipes.patch`
- `api.recipes.overwrite`
- `api.recipes.review`

### DB trace names
Use `recipes_<operation>` in `traceDb(...)` calls:
- `recipes_create`
- `recipes_search`
- `recipes_get_by_public_id`
- `recipes_update`
- `recipes_review_queue`
- `recipes_duplicate_lookup`

## Payload shape guidance
- Keep telemetry summaries lightweight and structured.
- Prefer counters and identifiers over raw payload capture.
- Recommended fields:
  - `public_id`
  - `status`
  - `ingredient_count`
  - `instruction_count`
  - `q_len`
  - `count` (for queue/list responses)
- Do not include full `capture_text`, full ingredients/instructions arrays, or large metadata blobs in telemetry payloads.

## Failure mapping guidance
- Duplicate title should remain explicit via `recipe_duplicate_title` at API level (HTTP 409) with `existing_public_id`.
- Missing-table/runtime schema issues should map to a stable 500 path (`recipes table missing`) from store-level wrapping.
- Validation failures should remain 400 with normalized error messages from input builders.

## Relationship to authoritative docs
- API contracts remain authoritative in `docs/api_recipes.md` and `docs/api.md`.
- Table/index/grant facts remain authoritative in `docs/database_schema.md`.
- This file is an implementation convention note for consistent telemetry instrumentation.

# Backend API: Recipes

## Purpose
- define internal backend contracts for the dedicated recipes surface
- keep recipe create/search/get/update/review queue semantics explicit for n8n and debug tooling

## Authoritative For
- `/recipes/*` request and response contracts
- recipe-specific validation, dedupe, review-status recomputation, and archived visibility rules

## Not Authoritative For
- recipe table DDL and grants; use `docs/database_schema.md`
- Telegram public webhook routing; use `docs/external_api.md`

## Read When
- adding or changing recipe endpoints
- reviewing recipe capture/retrieval behavior and response shape

## Update When
- any `/recipes/*` endpoint shape changes
- recipe status/review/dedupe behavior changes

## Related Docs
- `docs/api.md`
- `docs/database_schema.md`
- `docs/PRD/recipes-prd.md`
- `docs/n8n_backend_contract_map.md`

## Endpoint Map

| Endpoint | Auth | Primary callers | Notes |
|---|---|---|---|
| `POST /recipes/create` | internal | recipe capture workflows, debug UI | supports structured fields or `capture_text` one-shot parsing |
| `POST /recipes/search` | internal | recipe retrieval workflows, debug UI | returns top hit + alternatives; excludes archived |
| `POST /recipes/get` | internal | `/recipe R<number>` flow, debug UI | direct lookup by `public_id`; includes archived |
| `POST /recipes/patch` | internal | debug UI, operator tooling | partial updates; status recomputed except archived-preserve rule |
| `POST /recipes/overwrite` | internal | debug UI, operator tooling | full overwrite; required fields enforced |
| `POST /recipes/link` | internal | `/recipe-link` workflow, debug UI | idempotent bidirectional link between exactly two recipes |
| `POST /recipes/note` | internal | `/recipe-note` workflow | append-only note path; auto-capitalizes first letter |
| `GET /recipes/review` | internal | debug UI, operator tooling | review queue of `needs_review` rows |

## Shared Rules

- Required create/overwrite fields:
  - `title`
  - `servings`
  - `ingredients`
  - `instructions`
  - `capture_text`
- Dedupe key: case-insensitive exact title (`title_normalized`).
- Duplicate create/update title collision returns HTTP `409` with:
  - `error: "duplicate_recipe_title"`
  - `existing_public_id`
- Review-trigger fields:
  - `cuisine`
  - `protein`
  - `prep_time_minutes`
  - `cook_time_minutes`
  - `difficulty`
  - `servings`
- Status recompute rule:
  - recompute `active` vs `needs_review` on writes
  - preserve `archived` unless explicitly changed
- Active-schema rule:
  - all `/recipes/*` routes resolve table location from persisted runtime `is_test_mode`
  - writes/reads target `pkm.recipes` or `pkm_test.recipes` accordingly

## Telegram Command Mapping (V1)

- `/recipe R<number>` -> `POST /recipes/get`
- `/recipe <query>` -> `POST /recipes/search`
- `/recipes <query>` -> `POST /recipes/search`
- `/recipe-save <structured_recipe_text>` -> `POST /recipes/create`
- `/recipe-link <public_id_1> <public_id_2>` -> `POST /recipes/link`
- `/recipe-note <public_id> <note>` -> `POST /recipes/note`

## `POST /recipes/create`

Create a recipe row.

Request body (structured):
```json
{
  "title": "Lemon Pasta",
  "servings": 4,
  "ingredients": ["300g pasta", "lemon zest"],
  "instructions": ["Boil pasta", "Toss with lemon"],
  "notes": "Optional parmesan",
  "cuisine": "Italian",
  "protein": "None",
  "prep_time_minutes": 15,
  "cook_time_minutes": 20,
  "difficulty": "Easy",
  "tags": ["weeknight", "pasta"],
  "capture_text": "# Lemon Pasta ..."
}
```

Request body (one-shot capture):
```json
{
  "capture_text": "# Lemon Pasta\n\n- Servings: 4\n..."
}
```

Response `200` (full payload):
```json
{
  "public_id": "R17",
  "title": "Lemon Pasta",
  "status": "needs_review",
  "review_reasons": ["missing_protein"]
}
```

## `POST /recipes/search`

Search recipes using lexical ranking.

Request:
```json
{
  "q": "lemon pasta",
  "alternatives_count": 2
}
```

Response `200`:
```json
{
  "query": "lemon pasta",
  "top_hit": {
    "public_id": "R17",
    "title": "Lemon Pasta",
    "status": "active"
  },
  "alternatives": [
    { "public_id": "R18", "title": "Creamy Pasta", "status": "active" },
    { "public_id": "R33", "title": "Lemon Chicken", "status": "needs_review" }
  ],
  "total_candidates": 3
}
```

Notes:
- `archived` rows are excluded.
- return shape is intentionally one full top hit plus compact alternatives.

## `POST /recipes/get`

Get recipe by `public_id`.

Request:
```json
{
  "public_id": "R17"
}
```

Response `200`: full recipe payload.

Full recipe payload now also includes:
- `linked_recipes`: array of linked recipe summaries (`public_id`, `title`, `status`)

Response `404`: not found.

## `POST /recipes/patch`

Patch selected fields.

Request:
```json
{
  "public_id": "R17",
  "patch": {
    "cuisine": "Italian",
    "difficulty": "Easy"
  }
}
```

Response `200`: full recipe payload.

## `POST /recipes/overwrite`

Overwrite recipe content with a full payload.

Request:
```json
{
  "public_id": "R17",
  "recipe": {
    "title": "Lemon Pasta",
    "servings": 4,
    "ingredients": ["300g pasta"],
    "instructions": ["Boil pasta"],
    "capture_text": "# Lemon Pasta ..."
  }
}
```

Response `200`: full recipe payload.

## `POST /recipes/link`

Create (or refresh) a bidirectional link between two recipes.

Request:
```json
{
  "public_id_1": "R2",
  "public_id_2": "R123"
}
```

Response `200`: full recipe payload for `public_id_1`, including updated `linked_recipes`.

Response `400`: invalid id or self-link attempt.

Response `404`: one of the recipe ids does not exist.

## `POST /recipes/note`

Append one note line/paragraph to the bottom of an existing recipe's notes.

Request:
```json
{
  "public_id": "R123",
  "note": "this is a very important note."
}
```

Behavior:
- note text is append-only through this endpoint
- first letter is auto-capitalized (`this...` -> `This...`)
- existing note text is preserved and new note is appended to the bottom

Response `200`: full updated recipe payload.

Response `404`: recipe not found.

## `GET /recipes/review`

List recipes currently marked `needs_review`.

Query params:
- `limit` (optional, default `50`, max `200`)

Response `200`:
```json
{
  "rows": [
    {
      "id": 42,
      "public_id": "R17",
      "title": "Lemon Pasta",
      "status": "needs_review",
      "review_reasons": ["missing_protein"],
      "created_at": "2026-04-02T00:00:00.000Z"
    }
  ],
  "limit": 50
}
```

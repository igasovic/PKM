# AGENTS

## Purpose

## Scope

## Responsibilities

## Communication Protocol

## Logging And Observability
- Use the shared backend logger (`src/server/logger`) for pipeline transition logs.
- Keep heavy payload fields summarized (counts + hashes), not raw.
- LLM telemetry goes to Braintrust; transition telemetry goes to Postgres `pipeline_events`.

## Error Handling

## Database Safety
- No raw SQL outside `src/libs/sql-builder.js` and `src/server/db.js`.
- Business logic must call DB module methods (for example `db.insertPipelineEvent(...)`) rather than issuing SQL directly.

## API Compatibility

## Testing And Validation

## Change Management

## Security And Secrets

## Performance Guidelines

## Deployment And Operations

## Documentation Standards

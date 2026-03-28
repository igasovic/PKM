# PKM MCP API (Legacy)

Status: legacy/disabled for ChatGPT integration as of 2026-03-26.

This document is kept only as historical reference during the n8n-first transition.

Current behavior:
- `POST /mcp` returns HTTP `410` with `error = "legacy_disabled"`.
- Supported ChatGPT path is GPT action -> n8n webhook -> internal backend action routes.

Active contracts now live in:
- `docs/external_api.md` (public Custom GPT webhook contract)
- `chatgpt/action_schema.yaml` (OpenAPI action schema for Custom GPT)
- `docs/api.md` (`/chatgpt/working_memory`, `/chatgpt/wrap-commit`)
- `docs/PRD/MCP-PRD.md`
- `chatgpt/project_instructions.md`

# ops/stack/env

Committed, non-secret env overlays used by the Docker surface.

Guidelines:
- Keep secrets out of this directory.
- Runtime secret file `/home/igasovic/stack/.env` is host-local and out of repo scope.
- Use `importcfg docker` (or `updatecfg docker --pull`) to import managed non-secret env files.

Current managed overlays:
- `pkm-server.env` (backend non-secret runtime config)
- `n8n.env` (n8n non-secret runtime config, including `TELEGRAM_ADMIN_CHAT_ID`)

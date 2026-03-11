# ops/stack/env

Committed, non-secret env overlays used by the Docker surface.

Guidelines:
- Keep secrets out of this directory.
- Runtime secret file `/home/igasovic/stack/.env` is host-local and out of repo scope.
- Use `updatecfg docker --mode pull` to import managed non-secret env files.

# ops/stack

Repo-owned configuration surface for stack-level runtime targets.

This tree is intentionally versioned and non-secret.

Populate/update these files with:
- `scripts/cfg/updatecfg <surface> --pull` to import managed runtime config into repo
- `scripts/cfg/updatecfg <surface> --push` to apply repo config to runtime

Do not commit secrets from `/home/igasovic/stack/.env`.

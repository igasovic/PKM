# Service Dependency Graph

## Purpose
- document the authoritative dependency topology of the PKM stack
- make trust boundaries and service edges explicit for planning, review, and architecture work
- give coding agents a single place to verify how services are expected to interact

## Authoritative For
- service-to-service dependency edges
- public exposure boundaries
- trust boundaries between external systems, host services, and internal services
- which agent role should update the graph during change work

## Not Authoritative For
- exact ports, mounts, and stack-root host paths; use `docs/env.md`
- config surface ownership and operator apply workflow; use `docs/config_operations.md`
- code placement and dependency rules inside the repo; use `docs/repo-map.md`

## Read When
- planning or reviewing cross-component changes
- changing public entrypoints, tunnels, or service boundaries
- changing how n8n, pkm-server, Postgres, LiteLLM, or external systems connect

## Update Workflow
- Planning agent: first-pass update when a design changes topology or boundaries
- Architect agent: second-pass review when the change is cross-cutting or boundary-sensitive
- Coding agent: final update to match implemented real state before the work is complete

## Service Summary

| Service / edge | Exposure | Depends on | Notes |
|---|---|---|---|
| `cloudflared` | public publishing edge | Cloudflare Edge, Pi host services | publishes public hostnames to local origins |
| `n8n` | loopback on Pi host, public via Cloudflare | Postgres, pkm-server, Telegram, Gmail IMAP, Trafilatura, OneDrive | orchestration boundary |
| `pkm-server` | LAN-only | Postgres, LiteLLM, Braintrust | internal backend boundary |
| `postgres` | internal-only | none | durable state for PKM and n8n |
| `litellm` | LAN-only | OpenAI | OpenAI-compatible proxy/router |
| `homeassistant` | public via Cloudflare | Matter Server | out of current config program unless explicitly scoped |
| `matter-server` | LAN-only / host networking | local network protocols | Home Assistant backend dependency |

## Edge Legend

| Edge type | Meaning |
|---|---|
| public publish edge | external hostname exposure boundary |
| HTTP | service-to-service application call |
| SQL | database dependency |
| upstream | external provider dependency |
| traces and cost | observability / telemetry sink |

## Trust Boundaries

| Boundary | Why it matters |
|---|---|
| Internet -> Cloudflare / public hostnames | public exposure and auth posture |
| Cloudflare / host network -> internal containers | tunnel and origin routing boundary |
| n8n -> pkm-server | orchestration-to-backend boundary; should stay API-only |
| pkm-server -> Postgres | backend-owned DB access boundary |
| pkm-server -> LiteLLM -> OpenAI | LLM routing and provider boundary |

## Topology Notes
- `pkm-server` and `litellm` are not public entrypoints.
- `n8n` UI and webhook traffic are public only through Cloudflare and terminate at Pi-host loopback publish on `localhost:5678`.
- The graph is about dependency topology, not all operational detail.
- If exact runtime values matter, verify them in `docs/env.md`.

```mermaid
flowchart LR
  subgraph Internet[Internet / External Services]
    OpenAI[(OpenAI API)]
    BT[Braintrust tracing and cost]
    TG[Telegram API]
    GmailIMAP[Gmail IMAP pkm.gasovic@gmail.com]
    OneDrive[OneDrive off-site backups]
    Trafilatura[Trafilatura HTTP extraction]
    CF[Cloudflare Edge]
    HAHost[ha.gasovic.com]
    N8NUIHost[n8n.gasovic.com]
    N8NHookHost[n8n-hook.gasovic.com]
  end

  subgraph Pi[pi Debian plus Docker]
    direction LR

    subgraph HostNet[host network]
      cloudflared[cloudflared tunnel]
      homeassistant[homeassistant 8123]
      mattersrv[matter-server 5580]
      n8n_port[localhost 5678 published to loopback]
    end

    subgraph InternalNet[docker network internal]
      n8n[n8n container]
      pkm[pkm-server 8080 published as 3010]
      litellm[litellm 4000]
      pg[(postgres 5432)]
      LG[LangGraph inside pkm-server]
    end
  end

  TG -->|commands and notifications| n8n
  GmailIMAP -->|email ingestion| n8n
  n8n -->|HTTP extract| Trafilatura
  n8n -->|upload backups| OneDrive

  n8n -->|HTTP| pkm
  pkm -->|SQL| pg

  pkm -->|OpenAI-compatible HTTP| litellm
  litellm -->|upstream| OpenAI

  pkm -->|traces and cost| BT
  pkm --> LG

  CF --> cloudflared
  cloudflared --> HAHost
  cloudflared --> N8NUIHost
  cloudflared --> N8NHookHost

  HAHost -->|origin http://localhost:8123| homeassistant
  N8NUIHost -->|origin http://localhost:5678| n8n_port
  N8NHookHost -->|origin http://localhost:5678| n8n_port

  n8n_port --> n8n
```

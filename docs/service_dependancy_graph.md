# Service_dependancy_graph.md

Detailed dependency graph for the Pi stack.

Notes:
- `pkm-server` and `litellm` are **LAN-only** (not published via Cloudflare Tunnel).
- `n8n` UI + webhook base URL are published via Cloudflare and terminate at the Pi host `localhost:5678`.
- Home Assistant is published via Cloudflare and terminates at `localhost:8123`.

```mermaid
flowchart LR
  %% =======================
  %% Internet / External
  %% =======================
  subgraph Internet[Internet / External Services]
    OpenAI[(OpenAI API)]
    BT[Braintrust (tracing + cost)]
    TG[Telegram API]
    GmailIMAP[Gmail IMAP<br/>pkm.gasovic@gmail.com]
    OneDrive[OneDrive (off-site backups)]
    Trafilatura[Trafilatura (HTTP extraction)]
    CF[Cloudflare Edge]
    HAHost[ha.gasovic.com]
    N8NUIHost[n8n.gasovic.com]
    N8NHookHost[n8n-hook.gasovic.com]
  end

  %% =======================
  %% Pi Host
  %% =======================
  subgraph Pi[pi (Debian + Docker)]
    direction LR

    %% Host-networked services
    subgraph HostNet[host network]
      cloudflared[cloudflared tunnel]
      homeassistant[homeassistant :8123]
      mattersrv[matter-server :5580]
      n8n_port[localhost:5678<br/>(n8n published to 127.0.0.1)]
    end

    %% Docker internal bridge network
    subgraph InternalNet[docker network: internal]
      n8n[n8n (container)]
      pkm[pkm-server :8080<br/>(published as :3010)]
      litellm[litellm :4000]
      pg[(postgres :5432)]
      LG[LangGraph (in pkm-server)]
    end
  end

  %% =======================
  %% PKM / n8n data plane
  %% =======================
  TG -->|commands + notifications| n8n
  GmailIMAP -->|email ingestion| n8n
  n8n -->|HTTP extract| Trafilatura
  n8n -->|upload backups| OneDrive

  n8n -->|HTTP| pkm
  pkm -->|SQL| pg

  %% LLM routing
  pkm -->|OpenAI-compatible HTTP| litellm
  litellm -->|upstream| OpenAI

  %% Observability / tracing
  pkm -->|traces + cost| BT

  %% LangGraph usage inside PKM server
  pkm --> LG

  %% =======================
  %% Cloudflare publishing (only HA + n8n)
  %% =======================
  CF --> cloudflared
  cloudflared --> HAHost
  cloudflared --> N8NUIHost
  cloudflared --> N8NHookHost

  HAHost -->|origin: http://localhost:8123| homeassistant
  N8NUIHost -->|origin: http://localhost:5678| n8n_port
  N8NHookHost -->|origin: http://localhost:5678| n8n_port

  %% n8n container is exposed via host loopback publish
  n8n_port --> n8n
```

# Koasis Agent fork deployment

Koasis now has a first-party fork layer around Hermes Agent instead of relying
on the public Hermes gateway. The upstream runtime is fetched at a pinned
commit while the Koasis repository owns the persona, evidence workflow,
artifact workflow, model route, and deployment contract.

## Runtime boundary

Run the stack on the same VPS/private Docker network:

```text
koasis-app:8080  →  http://koasis-agent:8642  →  model provider
       │
       └──────────→ PostgreSQL
```

Only `koasis-app` is public. The Agent port is exposed to the Docker network,
not published to the internet. There is still an HTTP API boundary, but it is a
private local-network hop instead of a Cloudflare/public bridge.

## Dokploy variables

Set these on the Koasis App service and the Agent service as appropriate:

```ini
KOASIS_AGENT_RUNTIME=hermes
KOASIS_HERMES_API_URL=http://koasis-agent:8642
KOASIS_HERMES_MODEL=koasis-agent
KOASIS_HERMES_API_KEY=<same internal caller key>
KOASIS_HERMES_PERSISTENCE=true

KOASIS_AGENT_API_KEY=<same internal caller key>
KOASIS_PROVIDER_API_KEY=<OpenAI-compatible provider key>
KOASIS_PROVIDER_BASE_URL=<OpenAI-compatible provider URL ending in /v1>
```

Do not put any of these values in a `VITE_*` variable. The caller key and model
provider key are different credentials and should be rotated independently.

## First deployment scope

The first image intentionally excludes messaging gateways, desktop UI, the
presentation renderer, and unnecessary media services. It includes the API
server, streaming runs, terminal/tool loop, MCP hooks, lightweight web search,
Koasis evidence instructions, and artifact instructions. Computer-use remains
approval-gated at the Koasis boundary; the next integration step is to expose
the approved Instabox actions to the Agent as a dedicated internal tool/MCP
surface.

## Rollback

Keep the current external runtime variables until this stack passes smoke tests.
Rollback is a configuration-only change back to the previous Hermes URL; no
browser bundle change is needed.

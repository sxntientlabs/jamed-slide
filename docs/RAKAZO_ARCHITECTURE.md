# Koasis agent runtime: Chat + Agentic

Koasis has two deliberately different execution modes. `Chat` stays in the
App Hosting backend and is optimized for context, conversation state, evidence
search, citations, and ordinary answers. `Agentic` is tool-capable and is
executed by the modified native Rakazo runtime on one InstaBox machine. Koasis
keeps the approval boundary and forwards the selected mode/context to a small
bridge next to Rakazo. The bridge has a deterministic native-RPC fast path for
simple navigation, while complex work uses Rakazo's normal thread, worker, and
tool loop.

This split keeps the public UI and ordinary conversations lightweight while
allowing tool-heavy work to use the isolated computer, worker, and artifact
capabilities of Rakazo.

## What is functional now

- Every request becomes a run with an id, selected specialist, model route,
  reasoning level, Computer approval mode, and explicit `agentMode`.
- `Chat` uses the embedded adapter and never silently starts a computer task.
- `Agentic` requires the user-facing Computer approval state before desktop
  side effects are allowed. Approved Agentic requests use the remote Rakazo
  bridge; unapproved Computer requests are rejected before they reach the
  worker.
- A simple approved navigation such as `buka docs` uses a deterministic
  native-RPC fast-path: boot/resume the shared machine, take a short-lived
  Computer control lease, send the URL through Rakazo's native input RPC, and
  release the lease without spending an LLM planning round.
- Run lifecycle events are kept in memory immediately and persisted to
  PostgreSQL when it is configured: accepted, preparing, generating, tool
  activity, finalizing, completed, and failed.
- `GET /api/rakazo/health` reports the runtime mode and capabilities without
  exposing credentials.
- `GET /api/rakazo/runs/:runId` returns the authenticated user's own run and
  sanitized activity metadata.
- Stream metadata identifies the harness as Rakazo, so the client can render
  the same activity contract when the worker moves again.

## Deployment boundary

The upstream Rakazo monorepo is not copied into Firebase App Hosting. Its full
API, worker, sandbox, and desktop stack would add unnecessary resource cost to
the public frontend. The current trial runs the native stack on the shared
InstaBox machine `koasis-omega`; the bridge is co-located there and does not
create a second PostgreSQL database.

For local development and App Hosting, set these server-only values:

```ini
KOASIS_RAKAZO_API_URL=https://<published-bridge-port>.<instabox-domain>
KOASIS_RAKAZO_BRIDGE_SECRET=<same-random-secret-as-the-bridge>
```

Do not put provider keys, PostgreSQL URLs, the Rakazo account credential, or
the bridge secret in a `VITE_*` variable. The provider endpoint and key are
configured inside Rakazo's own model connection, not in the browser.

Firebase App Hosting remains responsible for the public React shell, ordinary
Chat requests, the Koasis API boundary, and the approval-aware forwarding
boundary. InstaBox Omega is responsible for the native Rakazo API/worker/
PostgreSQL stack, shared Computer, and the bridge used by all Agentic tasks.
The VPS can continue to host PostgreSQL and heavy document rendering, but it is
not required to host the Agentic Computer runtime in this trial.

## Native Rakazo and bridge

The bridge is a deliberately small HTTP adapter beside the native Rakazo
Compose stack. Koasis sends every Agentic request to `POST /api/agent/chat`.
The bridge authenticates to Rakazo server-side, subscribes to the native event
stream, and emits Koasis NDJSON events. For a simple approved navigation it
calls Rakazo's `computer/status`, `computer/boot`, `computer/takeover`,
`computer/input`, and `computer/release` RPCs directly; this removes the slow
LLM planning round without creating a second Computer implementation. Complex
Computer work remains inside Rakazo's native worker/tool loop. No Firebase
token or provider key is forwarded to the browser.

Because the trial uses one shared Rakazo bot/thread, the bridge serializes all
bot and Computer work with a small in-process queue. A queued request reports
its position to Koasis rather than racing another session. Before each normal
chat turn, it clears the native thread and sends the current Koasis transcript,
so the native runtime does not retain another user's history. The bridge also
re-authenticates an expired session cookie before retrying the native SSE
subscription; polling remains only a compatibility fallback for deployments
that do not expose the stream.

Omega also runs a private provider compatibility proxy on the Compose network.
It forwards Rakazo's model request to the supplied OpenAI-compatible endpoint
and adds the terminal SSE sentinel that the upstream currently omits. The
provider key remains in Rakazo's credential store and is forwarded only on the
private machine network.

Required `rakazo-bridge.env` values:

```ini
PORT=8787
RAKAZO_URL=http://127.0.0.1:5173
RAKAZO_ORIGIN=https://<published-rakazo-web-port>.<instabox-domain>
RAKAZO_BOT_ID=<bot id created in the Rakazo UI>
RAKAZO_EMAIL=<service account email>
RAKAZO_PASSWORD=<service account password>
KOASIS_RAKAZO_BRIDGE_SECRET=<random shared secret>
```

`RAKAZO_SESSION_COOKIE` can replace the email/password pair when an operator
chooses to manage a long-lived service session explicitly. Do not commit this
file. The Compose override uses host networking so the bridge can reach the
loopback-only Rakazo web/API port without publishing Postgres or the internal
sandbox supervisor.

Start it from the Rakazo install directory:

```bash
docker compose --env-file .env -f docker-compose.images.yml \
  -f rakazo-bridge/docker-compose.bridge.yml up -d \
  koasis-rakazo-provider-proxy koasis-rakazo-bridge
```

Then publish the bridge port from the same machine with `instabox-port publish
8787 --name 'Koasis Rakazo bridge'`. Set the resulting HTTPS URL as
`KOASIS_RAKAZO_API_URL` and the same shared secret as
`KOASIS_RAKAZO_BRIDGE_SECRET` in the Koasis server runtime.

## Current trial status

- Native Rakazo and its Postgres/worker services are running on Omega.
- The bridge is published on port 8787 and rejects requests without the shared
  secret.
- The bridge uses bot `Koasis Agentic` and forwards only `agentMode: "agentic"`.
- The native Rakazo model connection is configured for model `koasis-agent` and
  uses the private provider compatibility proxy; the key remains server-side.
- The first end-to-end run exposed and fixed a Graphile Worker RLS policy gap on
  Omega's internal job tables. The worker was restarted and is now consuming
  queued runs.
- The public bridge was smoke-tested through the full native worker and model
  path: it returned `preparing`, `generating`, `delta`, `finalizing`, and
  `done` for `koasis-agent` in about five seconds.
- Concurrent requests were tested after the shared-thread fix: two prompts
  returned their own distinct answers, while the second request reported that
  it was queued. The local Koasis UI was also verified end-to-end with a
  streamed Agentic answer and the approved Computer navigation path.
- The native Computer status/boot RPC was verified on Omega while the machine
  was suspended. The bridge now uses that same path for approved simple
  navigation and refuses to steal a user-held Computer control lease.
- File attachments are not yet copied through the bridge. For the first trial,
  send a file link or use the existing embedded artifact path in Chat.

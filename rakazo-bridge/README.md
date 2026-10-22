# Koasis ↔ Rakazo bridge

This is a deliberately small HTTP adapter that runs beside the native Rakazo
Compose stack. Koasis sends only `Agentic` requests to `POST /api/agent/chat`.
The bridge authenticates to Rakazo server-side, submits the request through
Rakazo's native `threads/send` RPC, follows the matching run over the native
SSE stream, and emits Koasis NDJSON events. No Firebase token or provider key
is forwarded to the browser.

The bridge treats the selected Rakazo bot as a shared single-worker resource.
Requests are serialized so concurrent Koasis sessions cannot consume one
another's replies. Before a new chat turn is sent, the bridge clears the
native thread and supplies the current Koasis transcript; Koasis remains the
source of conversation persistence. If a configured session cookie expires,
the bridge re-authenticates with the service credentials and retries the SSE
subscription instead of silently falling back to a slow poll-only response.

The bridge is not a second agent runtime and does not duplicate Postgres. It is
only a translation boundary. Keep it on the same machine as Rakazo and expose
only its HTTPS port through InstaBox public ports.

The Compose override also runs a private provider compatibility proxy. It does
not store the provider key or publish a port; it forwards Rakazo's existing
authorization header and appends the `data: [DONE]` SSE sentinel required by
Rakazo when an upstream OpenAI-compatible server closes after its final chunk.
Rakazo should use the internal URL below as its model base URL:
`http://koasis-rakazo-provider-proxy:8788/v1`.

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

# Koasis agent runtime: Rakazo adapter

Koasis now has a lightweight Rakazo-compatible runtime boundary in
`server/rakazoAdapter.ts`. It is intentionally embedded in the existing
backend first, so the current chat, evidence search, citations, specialist
catalog, Computer approval, and artifact workflows continue to work while the
runtime is moved to Dokploy.

## What is functional now

- Every chat request becomes a run with an id, selected specialist, model route,
  reasoning level, and Computer approval mode.
- Run lifecycle events are kept in memory immediately and persisted to
  PostgreSQL when it is configured: accepted, preparing, generating, tool
  activity, finalizing, completed, and failed.
- `GET /api/rakazo/health` reports the runtime mode and capabilities without
  exposing credentials.
- `GET /api/rakazo/runs/:runId` returns the authenticated user's own run and
  sanitized activity metadata.
- The streamed chat metadata identifies the harness as Rakazo, so the client
  can render the same activity contract when the worker moves to Dokploy.

## Deployment boundary

The current default is `embedded`: Koasis uses the existing OpenAI-compatible
provider and the medical tools already present in this repository. The
upstream Rakazo monorepo is not copied into Firebase App Hosting because its
full API, worker, sandbox, and desktop stack would add unnecessary resource
cost to the frontend.

When the Dokploy service is ready, set `KOASIS_RAKAZO_API_URL` on that service
and point the App Hosting build's `VITE_KOASIS_API_BASE_URL` at the same
authenticated API contract. Do not put provider keys, PostgreSQL URLs, or
Rakazo secrets in a `VITE_*` variable.

The VPS remains responsible for PostgreSQL, the Rakazo worker/runtime,
Instabox integration, evidence-provider keys, and heavy document rendering.
Firebase App Hosting remains responsible for the public React shell and
static/client delivery.


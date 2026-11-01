#!/bin/sh
set -eu

: "${KOASIS_AGENT_API_KEY:?KOASIS_AGENT_API_KEY belum dikonfigurasi}"
: "${KOASIS_PROVIDER_API_KEY:?KOASIS_PROVIDER_API_KEY belum dikonfigurasi}"
: "${KOASIS_PROVIDER_BASE_URL:?KOASIS_PROVIDER_BASE_URL belum dikonfigurasi}"

HERMES_HOME="${HERMES_HOME:-/opt/data}"
export HERMES_HOME HOME="${HOME:-$HERMES_HOME}"
mkdir -p "$HERMES_HOME/skills" "$HERMES_HOME/logs"

# The data volume owns the active persona and skills. Seed them only when the
# volume is new, so an operator can safely refine the Koasis profile without
# the next container restart overwriting it.
if [ ! -s "$HERMES_HOME/SOUL.md" ]; then
  cp /opt/koasis-agent/SOUL.md "$HERMES_HOME/SOUL.md"
fi
cp -R /opt/koasis-agent/skills/. "$HERMES_HOME/skills/"

# Hermes reads provider and API-server credentials from its profile .env. This
# file is generated inside the private data volume and is never part of the
# image or the browser bundle.
umask 077
cat > "$HERMES_HOME/.env" <<EOF
OPENAI_API_KEY=${KOASIS_PROVIDER_API_KEY}
OPENAI_BASE_URL=${KOASIS_PROVIDER_BASE_URL}
API_SERVER_ENABLED=true
API_SERVER_HOST=${API_SERVER_HOST:-0.0.0.0}
API_SERVER_PORT=${API_SERVER_PORT:-8642}
API_SERVER_KEY=${KOASIS_AGENT_API_KEY}
EOF

# Keep the model route deterministic. The API server can still accept the
# standard OpenAI-compatible model field, but unknown aliases fall back to this
# Koasis model instead of silently selecting a provider default.
cat > "$HERMES_HOME/config.yaml" <<EOF
model:
  default: "${KOASIS_AGENT_MODEL:-koasis-agent}"
  provider: "custom"
  base_url: "${KOASIS_PROVIDER_BASE_URL}"
  streaming: true
  context_length: ${KOASIS_AGENT_CONTEXT_LENGTH:-65536}

platforms:
  api_server:
    enabled: true
    extra:
      model_routes:
        ${KOASIS_AGENT_MODEL:-koasis-agent}:
          model: "${KOASIS_AGENT_MODEL:-koasis-agent}"
          provider: "custom"
          base_url: "${KOASIS_PROVIDER_BASE_URL}"

agent:
  max_turns: ${KOASIS_AGENT_MAX_TURNS:-12}
  run_budget_seconds: ${KOASIS_AGENT_RUN_BUDGET_SECONDS:-480}
EOF

exec hermes gateway run

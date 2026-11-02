#!/bin/sh
set -eu

: "${KOASIS_AGENT_API_KEY:?KOASIS_AGENT_API_KEY belum dikonfigurasi}"
: "${KOASIS_PROVIDER_API_KEY:?KOASIS_PROVIDER_API_KEY belum dikonfigurasi}"
: "${KOASIS_PROVIDER_BASE_URL:?KOASIS_PROVIDER_BASE_URL belum dikonfigurasi}"

HERMES_HOME="${HERMES_HOME:-/opt/data}"
export HERMES_HOME HOME="${HOME:-$HERMES_HOME}"
export HERMES_CUA_DRIVER_CMD="${HERMES_CUA_DRIVER_CMD:-/usr/local/bin/cua-driver}"
export HERMES_WRITE_SAFE_ROOT="${HERMES_WRITE_SAFE_ROOT:-$HERMES_HOME}"
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

# Match the useful interactive Hermes/Telegram tool surface in the web chat:
# web, browser, terminal, files, memory, skills, vision, image generation,
# planning, delegation, code execution, cron, connections, plus clarification
# and text-to-speech. The explicit computer_use toolset is added separately
# because Hermes intentionally excludes it from the API-server bundle by default.
platform_toolsets:
  api_server:
    - "hermes-api-server"
    - "computer_use"
    - "clarify"
    - "tts"

# Agentic Computer runs inside this private container, not on the host desktop
# and not on an Instabox shared machine. Hermes starts the isolated Xfce/Xvnc
# desktop lazily on first use and keeps the browser profile in the data volume.
terminal:
  backend: "local"
  cwd: "${HERMES_HOME}"

bot_desktop:
  geometry: "${KOASIS_AGENT_DESKTOP_GEOMETRY:-1440x900}"
  auto_start: ${KOASIS_AGENT_COMPUTER_ENABLED:-true}
  min_free_memory_mb: ${KOASIS_AGENT_DESKTOP_MIN_FREE_MEMORY_MB:-1024}
  idle_stop_minutes: ${KOASIS_AGENT_DESKTOP_IDLE_MINUTES:-30}
  placement: "gateway"

browser:
  headed: true
  executable_path: "/usr/bin/chromium"

computer_use:
  backend: "cua"
  permission_mode: "standard"

agent:
  max_turns: ${KOASIS_AGENT_MAX_TURNS:-12}
  run_budget_seconds: ${KOASIS_AGENT_RUN_BUDGET_SECONDS:-480}
EOF

# Migrate data from the earlier root-owned image, then run Hermes as an
# unprivileged user. The container is the sandbox boundary; no host Docker
# socket is exposed.
if id pn >/dev/null 2>&1 && command -v runuser >/dev/null 2>&1; then
  chown -R pn:pn "$HERMES_HOME"
  exec runuser --user pn --preserve-environment -- hermes gateway run
fi

exec hermes gateway run

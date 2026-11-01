FROM python:3.14-slim-bookworm

ARG HERMES_REPO=https://github.com/NousResearch/hermes-agent.git
ARG HERMES_REF=a4994d4ead8f9c915b485cec5689909b349a49df

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HERMES_HOME=/opt/data \
    HOME=/opt/data \
    API_SERVER_ENABLED=true \
    API_SERVER_HOST=0.0.0.0 \
    API_SERVER_PORT=8642

WORKDIR /opt/hermes-source

# The runtime is built from a pinned upstream commit. Koasis-specific behavior
# lives in /opt/koasis-agent (persona, skills, and startup policy) so upstream
# updates can be reviewed and rebased without copying the whole repository into
# the Koasis application.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      curl \
      build-essential \
      libffi-dev \
      libolm-dev \
    && rm -rf /var/lib/apt/lists/* \
    && git init . \
    && git remote add origin "${HERMES_REPO}" \
    && git fetch --depth 1 origin "${HERMES_REF}" \
    && git checkout --detach "${HERMES_REF}"

# Keep the first deployment focused on the API server, terminal/tool loop,
# MCP, computer-use hooks, and lightweight web discovery. Messaging gateways,
# desktop UI, and presentation tooling stay out of this image.
# Use the pinned upstream lockfile.  Hermes intentionally carries a uv
# override for the Pillow version required by browser-harness; pip's resolver
# rejects that valid lockfile combination as a hard conflict.
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir "uv==0.12.3" \
    && uv sync --frozen --no-dev --extra mcp --extra computer-use --extra ddgs \
    && uv pip install --python /opt/hermes-source/.venv/bin/python "aiohttp==3.14.5"

ENV PATH="/opt/hermes-source/.venv/bin:${PATH}"

COPY SOUL.md /opt/koasis-agent/SOUL.md
COPY entrypoint.sh /opt/koasis-agent/entrypoint.sh
COPY skills /opt/koasis-agent/skills

RUN chmod 0755 /opt/koasis-agent/entrypoint.sh \
    && mkdir -p /opt/data

EXPOSE 8642

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD sh -c 'curl -fsS -H "Authorization: Bearer ${KOASIS_AGENT_API_KEY}" http://127.0.0.1:8642/health >/dev/null'

ENTRYPOINT ["/opt/koasis-agent/entrypoint.sh"]

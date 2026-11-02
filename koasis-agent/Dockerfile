FROM python:3.14-slim-bookworm

ARG HERMES_REPO=https://github.com/NousResearch/hermes-agent.git
ARG HERMES_REF=a4994d4ead8f9c915b485cec5689909b349a49df
ARG CUA_DRIVER_VERSION=0.21.0
ARG CUA_DRIVER_AMD64_SHA256=cf29bfaad16737e31e72f38dad2a6424f24b21a4ac2edea885e83cb9d5034135
ARG CUA_DRIVER_ARM64_SHA256=6b3a308c6741dd8291aad22a308bd2ec8eb52eab64687be007ac86ceaf7e3307

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
      procps \
      tigervnc-standalone-server \
      xfce4-panel \
      xfwm4 \
      xfdesktop4 \
      xfce4-settings \
      xfce4-terminal \
      dbus-x11 \
      x11-xserver-utils \
      x11-utils \
      x11-xkb-utils \
      xauth \
      fonts-dejavu-core \
      at-spi2-core \
      libgtk-3-0 \
      libnss3 \
      libasound2 \
      libxss1 \
      chromium \
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

# Keep the private Bot Desktop accessibility bus explicit for Linux
# computer-use. This runs after uv sync so the final source tree is patched.
COPY koasis-agent/patch_bot_desktop.py /tmp/patch_bot_desktop.py
RUN python /tmp/patch_bot_desktop.py && rm -f /tmp/patch_bot_desktop.py

# The pinned Hermes revision expects the matching cua-driver release. Keep the
# driver in the Agent image so Computer never needs the host Docker socket or an
# external desktop provider. The checksum pins both supported VPS architectures.
ARG TARGETARCH
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) CUA_ARCH="x86_64"; CUA_SHA="${CUA_DRIVER_AMD64_SHA256}" ;; \
      arm64) CUA_ARCH="arm64"; CUA_SHA="${CUA_DRIVER_ARM64_SHA256}" ;; \
      *) echo "Unsupported TARGETARCH=${TARGETARCH} for cua-driver" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 120 \
      -o /tmp/cua-driver.tar.gz \
      "https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}/cua-driver-rs-${CUA_DRIVER_VERSION}-linux-${CUA_ARCH}-binary.tar.gz"; \
    printf '%s  %s\n' "${CUA_SHA}" /tmp/cua-driver.tar.gz | sha256sum -c -; \
    mkdir -p /opt/cua-driver; \
    tar -xzf /tmp/cua-driver.tar.gz -C /opt/cua-driver; \
    ln -sf /opt/cua-driver/cua-driver /usr/local/bin/cua-driver; \
    /usr/local/bin/cua-driver --version; \
    rm -f /tmp/cua-driver.tar.gz

ENV PATH="/opt/hermes-source/.venv/bin:${PATH}"

COPY koasis-agent/SOUL.md /opt/koasis-agent/SOUL.md
COPY koasis-agent/entrypoint.sh /opt/koasis-agent/entrypoint.sh
COPY koasis-agent/skills /opt/koasis-agent/skills

RUN chmod 0755 /opt/koasis-agent/entrypoint.sh \
    && mkdir -p /opt/data /tmp/.X11-unix /tmp/hermes-runtime \
    && chmod 1777 /tmp/.X11-unix \
    && useradd --create-home --shell /bin/bash pn \
    && chmod 0700 /tmp/hermes-runtime \
    && chown -R pn:pn /tmp/hermes-runtime /opt/data

# Keep the gateway and its disposable desktop out of root while leaving the
# entrypoint privileged long enough to migrate an existing named data volume.
ENV XDG_RUNTIME_DIR=/tmp/hermes-runtime

EXPOSE 8642

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD sh -c 'curl -fsS -H "Authorization: Bearer ${KOASIS_AGENT_API_KEY}" http://127.0.0.1:8642/health >/dev/null'

ENTRYPOINT ["/opt/koasis-agent/entrypoint.sh"]

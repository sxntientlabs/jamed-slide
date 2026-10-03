FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-impress \
      poppler-utils \
      fonts-dejavu \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin renderer

WORKDIR /app
COPY server.mjs ./server.mjs

USER renderer
EXPOSE 8080
CMD ["node", "server.mjs"]

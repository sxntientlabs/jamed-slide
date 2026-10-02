FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-core \
    libreoffice-impress \
    poppler-utils \
    fonts-dejavu \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "run", "start"]

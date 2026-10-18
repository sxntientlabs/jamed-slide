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

# Firebase client configuration is public and must be available while Vite
# builds the browser bundle. Server credentials stay runtime-only in Dokploy.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "run", "start"]

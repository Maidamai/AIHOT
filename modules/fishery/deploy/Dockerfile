# Dedicated trial image; the shared production image and host packages stay unchanged.
FROM node:24-trixie-slim AS base
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates poppler-utils \
 && rm -rf /var/lib/apt/lists/*
FROM base AS build
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/backend/package.json packages/backend/
COPY packages/contracts/package.json packages/contracts/
COPY industry/package.json industry/
COPY site/package.json site/
COPY modules/fishery/package.json modules/fishery/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @aihot/web && npm prune --omit=dev --no-audit --no-fund
FROM base
COPY --from=build --chown=node:node /app /app
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "apps/api/src/main.ts"]

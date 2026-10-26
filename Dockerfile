FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS builder
# Drizzle tooling still resolves optional native peers during dependency install.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Copy the full source BEFORE install: pnpm links workspace binaries
# per project, and installing against the real tree avoids stale-link issues.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r typecheck
RUN pnpm --filter @agent-os/web build

# Production database is remote Postgres; no native database addon is needed.
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /app/.runtime/workspaces /app/apps/web/.data \
  && chown -R node:node /app/.runtime /app/apps/web/.data \
  && mkdir -p /run/docker \
  && ln -s /run/docker-ca/ca.pem /run/docker/ca.pem \
  && ln -s /run/docker-cert/cert.pem /run/docker/cert.pem \
  && ln -s /run/docker-key/key.pem /run/docker/key.pem
USER node
WORKDIR /app/apps/web
EXPOSE 3000
# Cloud Run injects $PORT; default to 3000 locally. Run from apps/web so
# relative paths resolve exactly like local dev.
# Starts the standalone server; no package manager is needed at runtime.
CMD ["node", "server.js"]

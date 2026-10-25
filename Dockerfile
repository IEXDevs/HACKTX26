FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS builder
# Build tools required: better-sqlite3 compiles a native addon via node-gyp.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Copy the full source BEFORE install: pnpm links workspace binaries
# per project, and installing against the real tree avoids stale-link issues.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r typecheck
RUN pnpm --filter @agent-os/web build

# Runner: same Debian base so the better-sqlite3 binary built above loads.
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
EXPOSE 3000
# Cloud Run injects $PORT; default to 3000 locally. Run from apps/web so
# relative paths (SQLite file, sandbox root) resolve exactly like local dev.
# Uses the workspace's own next binary; no package manager needed at runtime.
CMD ["sh", "-c", "cd /app/apps/web && ./node_modules/.bin/next start -p ${PORT:-3000}"]

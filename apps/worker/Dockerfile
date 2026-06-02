# CRITICAL: Use node:20-slim, NOT Alpine
# GramJS client.connect() hangs indefinitely on Alpine (musl libc bug)
FROM node:20.19.5-slim AS base
RUN corepack enable
RUN npm install -g turbo@2.8.9

FROM base AS builder
WORKDIR /app
COPY . .
RUN turbo prune --scope=worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --shamefully-hoist

COPY --from=builder /app/out/full/ .
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo build --filter=worker

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 worker
USER worker

# esbuild bundles everything into dist/index.js + dist/gramjs/gramjs-worker.js
# Only native addons need node_modules at runtime
COPY --from=installer --chown=worker:nodejs /app/apps/worker/dist ./dist
COPY --from=installer --chown=worker:nodejs /app/node_modules ./node_modules

# package.json provides "type": "module" so Node.js loads .js as ESM
# (required for Worker Threads to correctly detect ESM format)
COPY --from=installer --chown=worker:nodejs /app/apps/worker/package.json ./package.json

# CRITICAL: exec form for SIGTERM propagation
CMD ["node", "dist/index.js"]

FROM node:26.3.0-slim AS base
RUN corepack enable
RUN npm install -g turbo@2.9.18

FROM base AS builder
WORKDIR /app
COPY . .
RUN turbo prune --scope=web --docker

FROM base AS installer
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --shamefully-hoist

COPY --from=builder /app/out/full/ .
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json

# Build-time placeholders — overridden by runtime environment variables.
# NEXT_PUBLIC_APP_URL must be a valid URL (Better Auth validates it during SSG).
# NEXT_PUBLIC_SUPABASE_* use __PLACEHOLDER__ strings replaced by entrypoint.sh at startup.
ARG DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
ARG BETTER_AUTH_SECRET=build-placeholder-secret-that-is-long-enough-for-validation
ARG BETTER_AUTH_URL=http://localhost:3000
ENV DATABASE_URL=$DATABASE_URL
ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
ENV NEXT_PUBLIC_APP_URL=https://build.placeholder.invalid
ENV NEXT_PUBLIC_SUPABASE_URL=__PLACEHOLDER_NEXT_PUBLIC_SUPABASE_URL__
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=__PLACEHOLDER_NEXT_PUBLIC_SUPABASE_ANON_KEY__

RUN pnpm turbo build --filter=web

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/entrypoint.sh ./entrypoint.sh

USER nextjs

EXPOSE 3000
# entrypoint.sh replaces __PLACEHOLDER_*__ in .js bundles then exec's node
CMD ["sh", "entrypoint.sh"]

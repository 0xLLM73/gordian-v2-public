# Gordian v2 - Agent Context

This repository is an experimental, unhosted open-source snapshot for building
Telegram-aware customer relationship workflows. Treat current public docs as the
source of truth. Files under `docs/archive/` are historical private-project
notes and may contain stale infrastructure guidance.

## Architecture

- Turborepo monorepo: `apps/web` (Next.js), `apps/worker` (Hono + BullMQ +
  grammY/GramJS), and shared packages.
- Packages: `@repo/db` (Drizzle schema/DAL), `@repo/crypto` (AES-GCM, HKDF,
  KMS helpers, masking), `@repo/shared` (schemas and handoff tokens).
- Runtime stores: PostgreSQL with pgvector plus Redis/Dragonfly-compatible
  cache/queues.
- Auth: Better Auth. Do not assume Clerk-era docs still apply.
- Deployment: no production deployment is included. Checked-in deploy files are
  examples only and must be renamed/reconfigured before use.

## Commands

- `pnpm install --frozen-lockfile` - install dependencies.
- `pnpm setup:local` - create `.env.local` with random local-only internal secrets.
- `pnpm demo:setup` - start local Postgres/Redis, migrate, and seed synthetic data.
- `pnpm demo:smoke` - run the local demo Playwright smoke test.
- `pnpm lint` - run Biome checks.
- `pnpm typecheck` - typecheck all workspaces.
- `pnpm test` - run Vitest suites through Turbo.

## Security Rules

- Keep Telegram disabled by default:
  `TELEGRAM_BOT_ENABLED=false`, `TELEGRAM_MTPROTO_ENABLED=false`,
  `TELEGRAM_SEND_ENABLED=false`,
  `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED=false`.
- Never test with a real Telegram account in a public fork. Use a new test bot,
  a new Telegram API app, a throwaway account, and a fresh local database/cache.
- Never commit `.env` files, logs, screenshots containing secrets, database
  dumps, real Telegram messages, phone numbers, session strings, or provider
  tokens.
- Server actions should derive `workspaceId` from the authenticated session and
  use workspace-scoped data access helpers.
- Do not expose worker routes publicly except health checks. Web-to-worker calls
  must use `WORKER_INTERNAL_SECRET` or `INTERNAL_AUTH_SECRET`.
- `DEV_KMS_BYPASS=true` is local demo/test only and must not be used for shared
  or production-like deployments.
- Do not embed raw PII for semantic search. Use entity masking before embedding.
- Redis/Dragonfly should not run in eviction/cache mode when it backs BullMQ.
- Local demo/setup commands should touch only loopback Postgres/Redis unless an explicit nonlocal override is set.

## Current Docs

- `README.md` - public setup and project overview.
- `ARCHITECTURE.md` - current public architecture overview.
- `docs/OPEN_SOURCE.md` - release checklist and Telegram threat model.
- `docs/PUBLIC_STATUS.md` - what is deleted, down, disabled, or not included.
- `docs/SECURITY_NOTES.md` - current security posture.
- `docs/CODEBASE_MAP.md` - file and module map.
- `docs/ENVIRONMENT_MATRIX.md` - environment variable inventory.

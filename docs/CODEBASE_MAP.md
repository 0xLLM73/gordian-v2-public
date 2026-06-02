# Codebase Map

This map describes the current open-source snapshot. Private historical implementation plans and older infrastructure notes are excluded from the public repository.

## Project Status

Gordian v2 is an experimental relationship-intelligence workspace. It is not deployed as a hosted service in this public snapshot.

- The original Telegram bot has been deleted.
- The old web, worker, DragonflyDB, and related deployment infrastructure are not live.
- Telegram account linking, MTProto sync, and Telegram sends are disabled by default.
- Any future Telegram testing should use a new test bot, a new Telegram API app, and a throwaway Telegram account.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app, dashboard UI, onboarding, settings, server actions, API routes. |
| `apps/worker` | Hono worker, Telegram integration code, BullMQ queue workers, AI processing, purge scripts. |
| `packages/db` | Drizzle schema, migrations, custom encrypted column types, data access layer. |
| `packages/crypto` | AES-GCM helpers, HKDF, KMS wrapping, blind indexes, entity masking. |
| `packages/shared` | Shared schemas and handoff token utilities used by web and worker. |
| `infra` | Example infrastructure configs only. Rename app names, volume names, and endpoints before use. |
| `scripts` | Local development and maintenance scripts, including synthetic seed data. |
| `docs` | Current public docs for setup, architecture, security, and CRM adaptation. |

## Runtime Shape

The codebase is designed as two apps plus shared packages:

```text
browser
  -> apps/web
      -> packages/db
      -> packages/crypto
      -> packages/shared
      -> apps/worker over internal HTTP for worker-owned jobs

apps/worker
  -> packages/db
  -> packages/crypto
  -> packages/shared
  -> PostgreSQL-compatible database
  -> Redis/Dragonfly-compatible queue/cache
  -> optional Telegram Bot API / MTProto only when explicitly enabled
```

## High-Risk Modules

| Area | Files | Notes |
| --- | --- | --- |
| Telegram feature flags | `apps/worker/src/telegram-config.ts`, `apps/web/src/lib/runtime-env.ts` | These gates keep Telegram disabled by default. |
| MTProto sessions | `apps/web/src/lib/auth-telegram.ts`, `apps/worker/src/gramjs/*`, `apps/worker/src/queues/sync.ts` | Stored sessions are high-risk credentials. Do not use real accounts in public forks. |
| Bot startup | `apps/worker/src/bot/index.ts` | Requires `TELEGRAM_BOT_ENABLED=true` and `BOT_TOKEN`; disabled by default. |
| Outbound Telegram sends | `apps/worker/src/routes/telegram.ts`, `apps/web/src/app/actions/chat-actions.ts` | Requires MTProto and send flags. Keep disabled for demos. |
| Encryption | `packages/crypto`, `packages/db/src/schema/custom-types.ts` | Workspace data uses encrypted custom types and KMS-oriented helpers. |
| Runtime purge | `apps/worker/scripts/purge-runtime-secrets.ts` | Sanitizes old DB/Redis runtime credentials before sharing or archiving. |

## Current Public Docs

| Doc | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | Current public architecture and deployment posture. |
| `docs/BUILDING_TELEGRAM_CRMS.md` | Practical guide for adapting the repo into a Telegram CRM product. |
| `docs/PUBLISHING.md` | Final local, GitHub, and provider-side publication gates. |
| `docs/PUBLIC_STATUS.md` | Plain-English status of deleted/down infrastructure and what remains to clean. |
| `docs/OPEN_SOURCE.md` | Release checklist and Telegram-specific threat model. |
| `docs/ENVIRONMENT_MATRIX.md` | Environment variable inventory for local or future demo deployments. |
| `docs/SECURITY_NOTES.md` | Current public security posture and Telegram risk summary. |
| `docs/archive/README.md` | Tombstone noting that private historical notes are excluded. |

## Validation Commands

```bash
pnpm install --frozen-lockfile
pnpm demo:setup
pnpm demo:smoke
pnpm audit:open-source
pnpm audit
pnpm audit --prod
pnpm lint
pnpm typecheck
pnpm test
```

To check whether old runtime storage contains credentials:

```bash
pnpm purge:secrets -- --dry-run
```

To purge a restored old runtime:

```bash
DATABASE_URL="postgres://..." DRAGONFLY_URL="redis://..." ALLOW_NONLOCAL_RUNTIME_PURGE=true pnpm purge:secrets -- --confirm
```

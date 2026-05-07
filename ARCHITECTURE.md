# Architecture

Gordian v2 is an experimental monorepo for building Telegram-aware customer
relationship workflows. The public snapshot is designed to run locally with
synthetic demo data and Telegram disabled by default.

This document is the current public architecture overview. Older private
planning notes live under `docs/archive/` and are historical only.

## System Shape

```text
browser
  -> apps/web
       -> packages/db
       -> packages/crypto
       -> packages/shared
       -> apps/worker over authenticated internal HTTP

apps/worker
  -> PostgreSQL-compatible database
  -> Redis/Dragonfly-compatible queue and cache
  -> optional Telegram Bot API and MTProto only when explicitly enabled
  -> optional AI providers for summaries, recommendations, and embeddings
```

## Workspaces

The product model is workspace-scoped:

- users belong to one or more workspaces;
- contacts, chats, messages, goals, deals, recommendations, summaries, and
  knowledge records are scoped by workspace;
- server actions derive `workspaceId` from the authenticated session instead of
  trusting client-provided workspace identifiers;
- database access is wrapped with workspace RLS context where the DAL supports it.

For a public fork, preserve this shape even if the product is renamed or narrowed.
Telegram data is sensitive enough that accidental cross-workspace reads should be
treated as a release blocker.

## Apps

### `apps/web`

The web app is a Next.js App Router application. It owns:

- login, signup, invites, and demo-login UI;
- dashboard pages for contacts, commitments, introductions, deals, goals,
  recommendations, knowledge, settings, and audit views;
- server actions that validate input and call shared packages;
- internal calls to the worker through `WORKER_URL` plus an internal secret;
- optional Telegram linking UI gated by `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED`.

### `apps/worker`

The worker is a Hono HTTP service plus background BullMQ workers. It owns:

- Telegram Bot API polling when `TELEGRAM_BOT_ENABLED=true`;
- GramJS/MTProto account linking and sync when `TELEGRAM_MTPROTO_ENABLED=true`;
- outbound Telegram sends only when both MTProto and `TELEGRAM_SEND_ENABLED=true`;
- queue processors for sync, summaries, recommendations, health scoring,
  knowledge extraction, outcomes, and scheduled jobs;
- the runtime purge script used to clear restored database or Redis secrets.

The worker should be reachable only by trusted web/service components in a real
deployment. Public forks should treat `/health` as the only route safe to expose
without internal authentication.

## Shared Packages

| Package | Purpose |
| --- | --- |
| `packages/db` | Drizzle schema, migrations, data access helpers, RLS utilities, feature flags, and encrypted custom column types. |
| `packages/crypto` | AES-GCM helpers, HKDF key derivation, KMS envelope helpers, blind indexes, and entity masking. |
| `packages/shared` | Shared schemas and handoff-token helpers used by web and worker. |

## Data Stores

Local development uses Docker Compose with PostgreSQL plus pgvector and a
Redis-compatible cache:

- PostgreSQL stores workspaces, auth records, contacts, messages, summaries,
  goals, deals, recommendations, audit records, and encrypted Telegram sessions;
- Redis/Dragonfly stores queues, rate-limit keys, short-lived Telegram auth
  state, idempotency keys, and scheduler state;
- no runtime database rows or Redis values are committed to the repository.

## Telegram Boundary

Telegram is the highest-risk integration in this codebase.

Default public configuration:

```env
TELEGRAM_BOT_ENABLED="false"
TELEGRAM_MTPROTO_ENABLED="false"
TELEGRAM_SEND_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="false"
```

Important guards:

- worker routes for linking and sync return `503` when MTProto is disabled;
- outbound sends return `503` unless MTProto and send gates are both enabled;
- the web UI hides linking unless both server and public linking flags are on;
- Bot API polling does not start unless explicitly enabled;
- send-code and verify-code require the internal service secret;
- verify-code stores Telegram sessions encrypted before they leave the worker.

Any contributor testing Telegram should use a new test bot, a new Telegram API
app, a throwaway Telegram user account, and a fresh local database/cache.

## Internal Auth

Web-to-worker calls use an internal secret:

- `WORKER_INTERNAL_SECRET` is preferred;
- `INTERNAL_AUTH_SECRET` remains as a compatibility fallback;
- comparisons are normalized through HMAC before `timingSafeEqual`;
- production-like worker startup fails if neither secret is configured.

User-initiated worker actions can also use short-lived handoff tokens where the
route supports them.

## Encryption

The codebase uses field-level encryption and workspace key envelopes:

- workspace root keys are generated per workspace;
- production-style use expects AWS KMS or a compatible key-management boundary;
- `DEV_KMS_BYPASS=true` is only for local demo/test runs and refuses to run when
  `NODE_ENV` is not `development` or `test`;
- Telegram MTProto sessions are encrypted with per-user session KEKs;
- entity masking helpers exist so AI embeddings do not need raw PII.

Before any shared or hosted deployment, replace demo secrets, disable
`DEV_KMS_BYPASS`, configure real key management, and complete a privacy review.

## AI and Background Processing

AI features are implemented as worker-side pipelines, not as required local setup:

- summaries and relationship extraction;
- commitment and goal extraction;
- recommendations and follow-up planning;
- embeddings and knowledge search;
- outcome scoring and health scoring.

Local demo data can run without Telegram, but some AI jobs require provider keys
before they can process live queues. Missing provider keys should be treated as a
deployment configuration issue, not as a reason to enable real Telegram accounts.

## Deployment Posture

No production deployment is included in this public snapshot.

The checked-in deployment files are examples only. Before deploying a fork:

- change every app name, volume name, endpoint, and provider-specific identifier;
- keep worker routes private except for health checks;
- store all secrets in the deployment provider, not in the repo;
- keep public CI focused on install, lint, typecheck, tests, and demo smoke;
- do not add automatic production deploys until the fork has its own throwaway or
  reviewed infrastructure.

See `docs/OPEN_SOURCE.md`, `docs/PUBLIC_STATUS.md`, and
`docs/ENVIRONMENT_MATRIX.md` before publishing or deploying.

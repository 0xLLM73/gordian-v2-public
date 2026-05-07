# Gordian v2

Gordian v2 is an experimental relationship-intelligence workspace built around Telegram contact sync, encrypted workspace data, and AI-assisted summaries, commitments, goals, deals, and follow-up planning.

This repository is being prepared for open-source release. It is not a turnkey hosted product, no production deployment is included, and the original Telegram bot has been deleted. The old website, worker, and DragonflyDB infrastructure are no longer live.

Telegram integration is disabled by default because MTProto user sessions are high-risk credentials.

## Security Posture

The sensitive part of this project is Telegram account access:

- `BOT_TOKEN` controls the Telegram bot and can message users who interacted with it.
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` identify the Telegram API app used by GramJS.
- Saved MTProto session strings are the highest-risk material. A stolen session can read account data and send messages as the connected Telegram account until revoked.

For that reason, fresh clones ship with all Telegram access disabled:

```env
TELEGRAM_BOT_ENABLED="false"
TELEGRAM_MTPROTO_ENABLED="false"
TELEGRAM_SEND_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="false"
```

Only enable these flags with a new dedicated test Telegram app, a new test bot, and a throwaway Telegram account.

## Repository Layout

- `apps/web` - Next.js app, dashboard, onboarding, settings, and server actions.
- `apps/worker` - Hono worker, grammY bot, GramJS thread pool, BullMQ workers, AI queues.
- `packages/db` - Drizzle schema, migrations, and data access layer.
- `packages/crypto` - encryption, KMS wrapping, HKDF, blind indexes, masking helpers.
- `packages/shared` - shared schemas and handoff token utilities.
- `docs` - current public docs for setup, architecture, security, and CRM adaptation.

## Local Setup

Requirements:

- Node.js 20
- pnpm 9
- Docker, or a PostgreSQL-compatible database with pgvector installed
- Redis or DragonflyDB

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm demo:setup
pnpm demo:smoke
pnpm dev
```

`pnpm demo:setup` starts local Postgres/Redis, applies SQL migrations, and seeds synthetic demo workspaces. Telegram stays disabled.

`pnpm demo:smoke` installs the Chromium test browser if needed and runs the seeded demo Playwright smoke test with the same local-safe environment used by CI.

Demo login:

```text
Email: alice@gordian.dev
Password: gordian-demo
```

The local `.env.example` also enables a demo-login helper on the sign-in page. Turn
`NEXT_PUBLIC_DEMO_LOGIN_ENABLED` off before using a shared or deployed environment.

Validation:

```bash
pnpm audit:open-source
pnpm audit --prod
pnpm lint
pnpm typecheck
pnpm test
pnpm demo:smoke
```

The default `.env.example` is intentionally safe for open-source development and does not enable Telegram account access.

## Current Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) - current public architecture overview.
- [docs/BUILDING_TELEGRAM_CRMS.md](docs/BUILDING_TELEGRAM_CRMS.md) - guide for adapting the code into your own Telegram CRM.
- [docs/PUBLISHING.md](docs/PUBLISHING.md) - final local, GitHub, and provider-side publication gates.
- [docs/PUBLIC_STATUS.md](docs/PUBLIC_STATUS.md) - what is deleted, down, disabled, or still needs cleanup.
- [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md) - release checklist and Telegram threat model.
- [docs/SECURITY_NOTES.md](docs/SECURITY_NOTES.md) - current public security posture.
- [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) - current repository map.
- [docs/ENVIRONMENT_MATRIX.md](docs/ENVIRONMENT_MATRIX.md) - environment variable inventory.
- [docs/archive/README.md](docs/archive/README.md) - tombstone noting that private historical notes are excluded.
- [SECURITY.md](SECURITY.md) - vulnerability reporting and high-risk area guidance.
- [SUPPORT.md](SUPPORT.md) - support boundaries for the public snapshot.

## Open-Source Release Checklist

Before making the repository public, follow [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md). The short version:

- rotate every real production and staging secret;
- revoke old Telegram bot tokens and MTProto user sessions;
- run a secret scan across full git history, not only the current tree;
- run `pnpm audit:open-source`;
- run `pnpm audit --prod`;
- run `pnpm check:publication` after the repository is public and GitHub-side settings are available;
- rename or remove all example deployment app names, volume names, and tokens;
- keep deployment workflows manual/check-only until new open-source infrastructure is created;
- use mock or synthetic data for demos.

## License

MIT. See [LICENSE](LICENSE).

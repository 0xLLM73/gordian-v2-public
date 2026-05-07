# Public Status

Gordian v2 is shared as an experimental, unhosted public codebase.

## What Is Not Live

- The original Telegram bot has been deleted.
- The old website is not running.
- The old worker infrastructure is not running.
- The old DragonflyDB/Redis infrastructure is not running.
- No production deployment is included in this repository.
- Checked-in deployment configs are examples only and must be renamed before use.

## What Remains In The Repo

The repository still contains the source code for the web app, worker, database schema, encryption helpers, AI queues, and Telegram integration. Private historical planning docs and runbooks are excluded from the public snapshot. Telegram integration code remains for reference and possible future demo use, but all Telegram features are disabled by default in the public configuration.

## Local Demo

The public repo has a synthetic local demo path that does not use Telegram:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm demo:setup
pnpm demo:smoke
pnpm dev
```

Sign in with `alice@gordian.dev` and the local `SEED_PASSWORD` value from `.env.local`.

## Telegram Guidance

Do not connect a real Telegram account to this codebase. If someone wants to experiment with Telegram locally, they should create all-new throwaway resources:

- a new Telegram bot from `@BotFather`;
- a new Telegram API app;
- a throwaway Telegram user account;
- a fresh local database and Redis/Dragonfly instance.

## Runtime Cleanup

The repo cannot delete old hosted databases or backups by itself. If an old database or Redis/Dragonfly snapshot is restored later, run:

```bash
pnpm purge:secrets -- --dry-run
pnpm purge:secrets -- --confirm
```

The purge command loads `.env.local` by default and clears Telegram MTProto session ciphertext, account tokens, Better Auth sessions, verification values, calendar OAuth tokens, and volatile Telegram Redis keys.

## Public Sharing Checklist

- The repository contains no real `.env` files.
- GitHub Actions has no deployment secrets for old infrastructure.
- The public repository has Dependabot alerts/security updates, secret scanning, push protection, private vulnerability reporting, and `main` branch protection enabled.
- `pnpm check:publication` passes once GitHub-side settings are available.
- Keep Telegram flags disabled in `.env.example`.
- Before any fork or deployment goes live, confirm old provider dashboards no longer hold `BOT_TOKEN`, `TELEGRAM_API_ID`, or `TELEGRAM_API_HASH`.
- Before any fork or deployment goes live, confirm old DB/Redis snapshots are deleted or purged.
- Before any fork or deployment goes live, rename any example deployment config app names, volume names, endpoints, and secrets.

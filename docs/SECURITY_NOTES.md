# Security Notes

This file summarizes the security posture for the public snapshot. Private historical threat-model and incident-response notes are excluded from the public repository.

## Current Snapshot

- No hosted production deployment is included.
- The original Telegram bot has been deleted.
- The old website, worker, and DragonflyDB/Redis infrastructure are not live.
- Telegram bot polling, MTProto session creation, and Telegram sends are disabled by default.

## Primary Risk

Telegram MTProto user sessions are the highest-risk material in this codebase. A saved MTProto session can let an attacker read Telegram account data or send messages as the connected account until that session is revoked.

The public repository therefore assumes:

- no real Telegram bot token is safe to keep;
- no real Telegram API hash is safe to reuse if it touched old local files, logs, or screenshots;
- no persisted MTProto user session is safe to keep after sharing the repo;
- demo data must be synthetic.

## What To Use For Demos

Use only throwaway resources:

- a new Telegram bot;
- a new Telegram API app;
- a throwaway Telegram user account;
- a fresh local database;
- a fresh Redis/Dragonfly-compatible instance.

Keep `TELEGRAM_SEND_ENABLED=false` unless the send UX, rate limits, and audit path have been reviewed.

## Runtime Purge

If an old database or Redis/Dragonfly snapshot is restored, inspect and purge it before sharing:

```bash
pnpm purge:secrets -- --dry-run
DATABASE_URL="postgres://..." DRAGONFLY_URL="redis://..." pnpm purge:secrets -- --confirm
```

The purge command clears Telegram MTProto session ciphertext, account tokens, Better Auth sessions, verification values, calendar OAuth tokens, and volatile Telegram Redis keys.

## Repository Checks

Before making the repo public:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Also run a secret scanner across full git history. If any real credential appears in history, rotate it even if the commit is later removed or rewritten.

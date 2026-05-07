# Open-Source Release Guide

This guide covers the work required before publishing Gordian v2 as a public repository.

Current status: the original Telegram bot has been deleted, the old website and worker infrastructure are not live, and no production deployment is included in this repository. See [PUBLIC_STATUS.md](PUBLIC_STATUS.md) and [SECURITY_NOTES.md](SECURITY_NOTES.md).

## Threat Model

Telegram account access is the main release blocker.

The Telegram API app credentials identify the app, but the stored MTProto session strings are the dangerous credentials. A leaked session can allow an attacker to read dialogs/messages and send messages as the connected Telegram account until the session is revoked.

The public repository must therefore assume:

- no real Telegram bot token is safe to keep;
- no real `TELEGRAM_API_HASH` is safe to reuse if it ever lived in local files, CI logs, screenshots, or private commits;
- no persisted MTProto user session is safe to keep after publishing;
- demo data must be synthetic.

## Required Before Public Release

1. Rotate every secret.
   - `WORKER_INTERNAL_SECRET`
   - `INTERNAL_AUTH_SECRET`
   - `BETTER_AUTH_SECRET`
   - `HANDOFF_JWT_SECRET`
   - `OAUTH_STATE_SECRET`
   - database URLs and passwords
   - Supabase service and anon keys
   - AWS access keys and KMS-related credentials
   - AI provider keys
   - observability keys
   - GitHub Actions deployment tokens

2. Retire Telegram credentials.
   - Delete the old Telegram bot through BotFather, or revoke/rotate its token if preserving a bot.
   - Stop using any Telegram API app credentials that may have existed in this repo or local env files.
   - Create a dedicated test Telegram app for open-source demos.
   - Revoke all real Telegram user sessions connected to this project.
   - Delete encrypted Telegram session rows from non-demo databases.
   - Remove `BOT_TOKEN`, `TELEGRAM_API_ID`, and `TELEGRAM_API_HASH` from deployment providers and GitHub secrets.

3. Scan the full repository history.
   - Run a secret scanner on the complete git history, not a shallow clone.
   - If any real secret appears in history, rotate it even if history is later rewritten.
   - Prefer publishing from a clean repository if old history contains secrets or private operational context.
   - Run `pnpm audit --prod` and resolve production dependency advisories before publishing.

4. Keep Telegram disabled by default.
   - `TELEGRAM_BOT_ENABLED=false`
   - `TELEGRAM_MTPROTO_ENABLED=false`
   - `TELEGRAM_SEND_ENABLED=false`
   - `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED=false`

5. Separate public CI from private deployment.
   - CI should install, lint, typecheck, and run the full test suite.
   - Public pushes must not deploy to old production infrastructure.
   - Deployment tokens should not exist in the public repo unless tied to throwaway/demo infrastructure.
   - Treat checked-in Fly/Caddy/Docker/provider configs as examples only until every app name, volume name, endpoint, and provider identifier has been changed for the fork.
   - Keep deployment scripts explicitly named as examples. Do not add a generic `deploy` script that could target stale infrastructure by accident.

6. Do not publish private project archives.
   - Keep historical planning docs, incident notes, launch notes, private runbooks, and old threat models out of the public repository.
   - `docs/archive/` should remain a tombstone only.

7. Enable GitHub repository protections.
   - Secret scanning
   - Push protection
   - Dependabot alerts and security updates
   - Private vulnerability reporting
   - Branch protection for `main`

8. Run the external publication check after the repository is public.
   - `pnpm check:publication`
   - This command is expected to fail while the repository is private or while the GitHub account cannot enable secret scanning, push protection, or private vulnerability reporting.
   - See [PUBLISHING.md](PUBLISHING.md) for the full GitHub and provider-side checklist.

## Safe Demo Mode

For public demos, prefer one of these:

- synthetic Telegram-like fixtures loaded into a local database;
- a throwaway Telegram account with no real contacts;
- a dedicated test bot and test Telegram API app;
- outbound sending disabled permanently.

Never ask contributors to connect a real Telegram account while the project is experimental.
The original bot has been deleted; any future demo must create a new bot and new Telegram API app.

## Purging Runtime Secrets

The repository does not store runtime database rows or deployment-provider secrets, so use the purge script against any old runtime before making the project public:

```bash
pnpm purge:secrets -- --dry-run
DATABASE_URL="postgres://..." DRAGONFLY_URL="redis://..." pnpm purge:secrets -- --confirm
```

The script nulls Telegram MTProto session ciphertext in `accounts`, clears account access/refresh/ID tokens, deletes Better Auth sessions and verification values, clears calendar OAuth tokens, and removes volatile Telegram auth/send/session-lock Redis keys. It prints row/key counts only and never prints credential values.

This does not revoke credentials at the provider. Revoke Telegram bot tokens in BotFather, revoke real Telegram user sessions from the Telegram app, rotate any Telegram API app hash that may have leaked, and delete old secrets from GitHub Actions or deployment-provider dashboards.

## Enabling Telegram Locally

Use this only with throwaway credentials:

```env
TELEGRAM_BOT_ENABLED="true"
TELEGRAM_MTPROTO_ENABLED="true"
TELEGRAM_SEND_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="true"
BOT_TOKEN="<test bot token>"
TELEGRAM_API_ID="<test app id>"
TELEGRAM_API_HASH="<test app hash>"
```

Set `TELEGRAM_SEND_ENABLED=true` only after reviewing the send confirmation UI, rate limits, audit logging, and all feature flags for the workspace.

## What This Repo Now Does By Default

- The worker does not start grammY polling unless `TELEGRAM_BOT_ENABLED=true`.
- The worker does not schedule periodic MTProto sync unless `TELEGRAM_MTPROTO_ENABLED=true`.
- Telegram linking and sync routes return `503` when MTProto is disabled.
- Telegram sends return `503` unless both MTProto and send flags are enabled.
- The web UI hides Telegram linking unless `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED=true`.
- GitHub Actions runs CI only and no longer deploys on `main` pushes.

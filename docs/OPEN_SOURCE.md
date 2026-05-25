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
   - local/proxy AI endpoint bearer tokens, if used
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
   - Run `pnpm audit:open-source`; it requires Gitleaks and fails on a shallow clone.
   - CI installs a pinned Gitleaks release with a pinned checksum before scanning.
   - If any real secret appears in history, rotate it even if history is later rewritten.
   - Prefer publishing from a clean repository if old history contains secrets or private operational context.
   - Run `pnpm audit` and resolve dependency advisories before publishing.
   - Run `pnpm audit --prod` and resolve production dependency advisories before publishing.

4. Keep Telegram disabled by default.
   - `TELEGRAM_BOT_ENABLED=false`
   - `TELEGRAM_MTPROTO_ENABLED=false`
   - `TELEGRAM_SEND_ENABLED=false`
   - `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED=false`

5. Keep account creation invite-only.
   - Public Better Auth email signup is disabled server-side.
   - New users must come through a workspace invite link.
   - Invite acceptance is single-use and rejects already-consumed tokens.

6. Separate public CI from private deployment.
   - CI should install, lint, typecheck, and run the full test suite.
   - Public pushes must not deploy to old production infrastructure.
   - Deployment tokens should not exist in the public repo unless tied to throwaway/demo infrastructure.
   - Treat checked-in Fly/Caddy/Docker/provider configs as examples only until every app name, volume name, endpoint, and provider identifier has been changed for the fork.
   - Keep deployment scripts explicitly named as examples. Do not add a generic `deploy` script that could target stale infrastructure by accident.

7. Do not publish private project archives.
   - Keep historical planning docs, incident notes, launch notes, private runbooks, and old threat models out of the public repository.
   - `docs/archive/` should remain a tombstone only.

8. Enable GitHub repository protections.
   - Secret scanning
   - Push protection
   - Dependabot alerts and security updates
   - Dependabot version-update coverage for npm, GitHub Actions, Dockerfiles, and Docker Compose services
   - Private vulnerability reporting
   - Branch protection for `main`

9. Run the external publication check after the repository is public.
   - `pnpm check:publication`
   - This command is expected to fail while the repository is private or while the GitHub account cannot enable secret scanning, push protection, or private vulnerability reporting.
   - See [PUBLISHING.md](PUBLISHING.md) for the full GitHub and provider-side checklist.

9. Use generated local secrets.
   - Run `pnpm setup:local` instead of copying `.env.example` directly.
   - `BETTER_AUTH_SECRET`, `INTERNAL_AUTH_SECRET`, `WORKER_INTERNAL_SECRET`, and `OAUTH_STATE_SECRET` must be random per clone.
   - Local demo setup refuses nonlocal `DATABASE_URL`, `DIRECT_URL`, and Redis URLs unless `ALLOW_NONLOCAL_DEMO_TARGETS=true` is set intentionally.

## Safe Demo Mode

For public demos, prefer one of these:

- synthetic Telegram-like fixtures loaded into a local database;
- local Nomic KG AI or Qwen vector-only KG embeddings configured with `pnpm local-ai:setup:nomic` or `pnpm local-ai:setup:qwen` and verified with `pnpm kg:local:smoke`;
- a throwaway Telegram account with no real contacts;
- a dedicated test bot and test Telegram API app;
- outbound sending disabled permanently.

Never ask contributors to connect a real Telegram account while the project is experimental.
The original bot has been deleted; any future demo must create a new bot and new Telegram API app.

## Purging Runtime Secrets

The repository does not store runtime database rows or deployment-provider secrets, so use the purge script against any old runtime before making the project public:

```bash
pnpm purge:secrets -- --dry-run
ALLOW_NONLOCAL_RUNTIME_PURGE=true DATABASE_URL="postgres://..." DRAGONFLY_URL="redis://..." pnpm purge:secrets -- --confirm
pnpm telegram:security-smoke --expect-purged
```

The script nulls Telegram MTProto session ciphertext in `accounts`, clears account access/refresh/ID tokens, deletes Better Auth sessions and verification values, clears calendar OAuth tokens, and removes volatile Telegram auth/send/session-lock Redis keys plus local BullMQ/session residue. It refuses nonlocal database/cache targets unless `ALLOW_NONLOCAL_RUNTIME_PURGE=true` is set. It prints row/key counts only and never prints credential values.

This does not revoke credentials at the provider. Revoke Telegram bot tokens in BotFather, revoke real Telegram user sessions from the Telegram app, rotate any Telegram API app hash that may have leaked, and delete old secrets from GitHub Actions or deployment-provider dashboards.

## Enabling Telegram Locally

Use this only with throwaway credentials:

```env
TELEGRAM_BOT_ENABLED="true"
TELEGRAM_MTPROTO_ENABLED="true"
TELEGRAM_SEND_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="true"
TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"
TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES="5"
TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="false"
TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"
TELEGRAM_API_CREDENTIAL_PROVIDER="os-keychain"
TELEGRAM_API_KEYCHAIN_ACCOUNT="telegram-api-credentials"
BOT_TOKEN="<test bot token>"
```

Use `TELEGRAM_SESSION_KEY_PROVIDER=os-keychain` for local macOS personal-account testing. The Telegram session unwrap key stays in macOS Keychain and only a marker is stored in Postgres. Run `pnpm telegram:keychain:harden` for existing local links so their Keychain items use `WhenUnlockedThisDeviceOnly`. `TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE=true` can require per-access Touch ID/password prompts, but unsigned local helpers may fail with macOS entitlement errors; keep it false unless the packaged helper has been verified. Use `aws-kms` with `KMS_CMK_ARN` and AWS credentials for a KMS-backed setup. The worker refuses to enable MTProto with `dev-insecure`.

Set `TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES=5` for personal-account testing. This terminates idle GramJS worker threads and drops decrypted Telegram client/session material from process memory after 5 idle minutes, without revoking or deleting the linked Telegram session.

Keep `TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS=false` for personal accounts so stored MTProto session unwrap is limited to the explicit Telegram history import flow. Set it to `true` only if you intentionally want legacy sync/backfill jobs to open the stored session.

Use `WORKSPACE_KEY_PROVIDER=os-keychain` for real local macOS workspaces. This keeps the workspace root key for encrypted messages, commitments, memories, and related local data in macOS Keychain while `workspaces.encrypted_wrk` stores only a marker. Run `pnpm workspace-key:migrate-local-keychain -- --apply` to move existing local dev workspace keys out of Postgres. Set `WORKSPACE_KEY_CACHE_TTL_MINUTES=60` for smoother local use, or a lower value for stricter memory exposure.

Use `pnpm telegram:setup` to store the Telegram API app `api_id` and `api_hash`
in macOS Keychain. In `os-keychain` mode, `pnpm telegram:doctor` fails if those
values still live in `.env.local`.

Run `pnpm telegram:security-smoke` after connecting or importing. It checks the
safe local posture plus Keychain-backed MTProto session KEK custody, fail-closed
`/telegram/send-message`, encrypted-looking Telegram account/message storage,
and volatile Redis auth/send/session-lock residue. Use
`pnpm telegram:security-smoke --expect-purged` after disconnecting and purging.

Set `TELEGRAM_SEND_ENABLED=true` only after reviewing the send confirmation UI, rate limits, audit logging, and all feature flags for the workspace.

## What This Repo Now Does By Default

- The worker does not start grammY polling unless `TELEGRAM_BOT_ENABLED=true`.
- The worker does not schedule periodic MTProto sync unless `TELEGRAM_MTPROTO_ENABLED=true`.
- Telegram linking and sync routes return `503` when MTProto is disabled.
- Telegram sends return `503` unless both MTProto and send flags are enabled.
- The web UI hides Telegram linking unless `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED=true`.
- Public email signup is disabled. Account creation is invite-only.
- Contact reads, message reads, Telegram sync, and Telegram sends are scoped to the authenticated user's linked Telegram account or explicit contact shares.
- Telegram relinking refuses to move an existing Telegram session to a different Gordian user.
- User account deletion is separated from workspace deletion; owners must choose the explicit workspace deletion action.
- GitHub Actions runs CI only and no longer deploys on `main` pushes.
- Local Docker Compose binds Postgres and Redis to `127.0.0.1` only.
- The worker binds to `127.0.0.1` by default outside production unless `WORKER_HOST` is set.

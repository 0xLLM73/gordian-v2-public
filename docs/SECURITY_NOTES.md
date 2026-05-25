# Security Notes

This file summarizes the security posture for the public snapshot. Private historical threat-model and incident-response notes are excluded from the public repository.

## Current Snapshot

- No hosted production deployment is included.
- The original Telegram bot has been deleted.
- The old website, worker, and DragonflyDB/Redis infrastructure are not live.
- Telegram bot polling, MTProto session creation, Telegram sends, full-history backfill, and periodic background sync are disabled by default. Group sync requires an explicit onboarding import choice.
- Public email signup is disabled server-side. New local users must use a workspace invite link.
- Contact/message reads and Telegram sync/send actions enforce account-level access for the authenticated user.

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

## Personal Telegram Account Mode

The safest supported personal-account posture is user-initiated and read-only:

- keep `TELEGRAM_SEND_ENABLED=false`;
- keep `TELEGRAM_FULL_BACKFILL_ENABLED=false`;
- keep `TELEGRAM_PERIODIC_SYNC_ENABLED=false`;
- choose the smallest onboarding import scope that is useful, starting with contacts only;
- leave `AI_PROCESSING_ENABLED=false` unless the user understands which configured providers may receive derived message content.
- leave `AI_SEARCH_EMBEDDINGS_ENABLED=false` unless semantic search egress is explicitly desired; search queries are masked before embedding when enabled.

Connecting Telegram creates a reusable local MTProto session. Disconnecting in Gordian removes the local encrypted session, but the user must also open Telegram Settings > Devices and terminate the Gordian session to revoke it from Telegram.

Relinking a Telegram account refreshes only the same Gordian user's existing Telegram session. If the Telegram account is already linked to a different Gordian user, the relink is rejected and the newly generated session key material is discarded.

MTProto session unwrap keys must use `TELEGRAM_SESSION_KEY_PROVIDER=os-keychain` or `TELEGRAM_SESSION_KEY_PROVIDER=aws-kms` before `TELEGRAM_MTPROTO_ENABLED=true`. The `os-keychain` provider stores the unwrap key in macOS Keychain and stores only a marker in Postgres. Run `pnpm telegram:keychain:harden` for already linked accounts so existing Keychain items are re-stored as `WhenUnlockedThisDeviceOnly`. `TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE=true` attempts per-access Touch ID/password prompts, but unsigned local helpers may fail with macOS entitlement errors; keep it false unless the packaged helper has been verified. The `aws-kms` provider stores an AWS KMS data-key ciphertext blob in Postgres. The `dev-insecure` provider is blocked for MTProto because it stores the unwrap key beside the encrypted session.

Follow-up for stricter per-access prompts: ship a signed/native local helper that can create and read the Telegram session Keychain item with user-presence access control, then gate `TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE=true` behind that verified packaging path. The current unsigned dev flow has been observed to fail with macOS `errSecMissingEntitlement`, so the supported local default is Keychain `WhenUnlockedThisDeviceOnly` plus import-only session unwrap.

`TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES` controls how long a local GramJS worker thread may keep a decrypted Telegram client/session in process memory while idle. Use `5` minutes for personal-account testing. Eviction disconnects the local worker and drops in-memory session material, but it does not revoke the linked Telegram session or delete the encrypted session row.

Keep `TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS=false` for personal accounts. This makes stored MTProto session unwrap an import-only capability; legacy sync and full-backfill workers cannot open the stored session unless an operator explicitly opts back in.

Real local workspaces should also use `WORKSPACE_KEY_PROVIDER=os-keychain` on macOS. That moves the workspace root key used for encrypted messages, commitments, memories, and related local data into macOS Keychain and leaves only a marker in `workspaces.encrypted_wrk`. Existing local demo workspaces can be migrated with `pnpm workspace-key:migrate-local-keychain -- --apply`. `WORKSPACE_KEY_CACHE_TTL_MINUTES` controls how long an unwrapped workspace key may remain in process memory; use `60` for smooth local use or a lower value for stricter local custody.

For OpenAI embeddings, normal macOS local users should run `pnpm openai:setup`
and use `OPENAI_API_KEY_PROVIDER=os-keychain`. This stores the API key in macOS
Keychain and keeps `OPENAI_API_KEY` blank in `.env.local`. ChatGPT OAuth is not
a supported general API credential path for this app today; use a restricted
OpenAI API key created for the local install.

For local knowledge graph AI, use `pnpm local-ai:setup:nomic` or the Qwen
vector-only preset with `pnpm local-ai:setup:qwen`, then verify with
`pnpm kg:local:smoke`. Local mode
avoids third-party KG embedding/extraction providers, but it does not make raw
message text public-safe: keep masking enabled, trust the local model server as
part of the local machine, and do not expose the local OpenAI-compatible
endpoint to the network without authentication. KG embedding vectors must remain
512-dimensional to match the database schema. If the embedding preset/model
changes, re-embed the KG before trusting semantic search quality.

Helicone prompt observability is off by default. Setting `HELICONE_API_KEY`
alone is not enough; set `HELICONE_ENABLED=true` and `AI_PROCESSING_ENABLED=true`
only after deciding that prompt and metadata observability may leave the local
machine.

## Runtime Purge

If an old database or Redis/Dragonfly snapshot is restored, inspect and purge it before sharing:

```bash
pnpm purge:secrets -- --dry-run
ALLOW_NONLOCAL_RUNTIME_PURGE=true DATABASE_URL="postgres://..." DRAGONFLY_URL="redis://..." pnpm purge:secrets -- --confirm
pnpm telegram:security-smoke --expect-purged
```

The purge command clears Telegram MTProto session ciphertext, OS Keychain session keys when configured, account tokens, Better Auth sessions, verification values, calendar OAuth tokens, volatile Telegram Redis keys, and local BullMQ/session residue. Nonlocal database/cache targets require `ALLOW_NONLOCAL_RUNTIME_PURGE=true`.
The security smoke verifies the post-purge state and checks Keychain custody,
fail-closed Telegram sending, encrypted-looking message storage, and volatile
Redis residue without printing secret values.

## Data Export And Deletion Boundaries

`GET /api/export` is a basic CRM export, not a complete account archive. It
includes contacts, active commitments, and deals. It does not include Telegram
message transcripts, chats, knowledge graph rows, memories, AI learning data,
audit logs, embeddings, Redis keys, or BullMQ queue payloads.

Deleting a user account removes that user's login/session shell, workspace
memberships, local Telegram session key material, and matching user/workspace
runtime residue. It does not wipe workspace data. Workspace owners must use the
explicit workspace deletion action; the UI no longer treats "delete my account"
as a workspace wipe.

Workspace deletion uses `deleteAccountData` to explicitly remove current-schema
workspace and user data, including goals/actions, deal candidates, golden
dataset rows, bandit learning rows, knowledge evidence, memories, messages,
summaries, audit rows, auth sessions, and account rows before deleting the
workspace and user. The web action also calls the worker's internal
`/runtime/cleanup-deletion` endpoint before database deletion to remove matching
non-active BullMQ jobs and workspace/user-scoped Redis keys. Active in-flight
jobs are not force-killed; stop the worker before deletion if you need a fully
quiescent local teardown.

## Repository Checks

Before making the repo public:

```bash
pnpm telegram:security-smoke --allow-missing-credentials --skip-db --skip-redis --skip-worker
pnpm lint
pnpm typecheck
pnpm test
```

Also run a secret scanner across full git history. If any real credential appears in history, rotate it even if the commit is later removed or rewritten.

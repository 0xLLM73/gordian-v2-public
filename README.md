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
TELEGRAM_FULL_BACKFILL_ENABLED="false"
TELEGRAM_PERIODIC_SYNC_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="false"
TELEGRAM_SESSION_KEY_PROVIDER="dev-insecure"
TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES="30"
WORKSPACE_KEY_PROVIDER="dev-insecure"
```

For a personal Telegram account on macOS, use `pnpm telegram:setup` to write the
read-only local flags and `pnpm telegram:doctor` to verify them before
connecting. The setup command uses `TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"`,
clears AWS KMS variables for the Telegram session-key path, and keeps sends,
full-history backfill, and periodic sync disabled. The onboarding flow will
require the user to choose an import scope before any contact, message, or group
sync starts. The default `dev-insecure` provider is for synthetic demos only;
the worker refuses to start MTProto with it. Disconnecting in Gordian
removes the local encrypted session and local Keychain unwrap key when present;
users must also open Telegram Settings > Devices and terminate the Gordian
session to revoke it from Telegram itself.
`TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES="30"` controls how long the local GramJS
worker may keep a decrypted Telegram client/session in process memory while idle;
it does not revoke the saved Telegram session.

Real local macOS workspaces should also use `WORKSPACE_KEY_PROVIDER="os-keychain"`.
That keeps the workspace root key for encrypted messages, commitments, memories,
and related local data in macOS Keychain while Postgres stores only a marker.
Existing local demo workspaces can be moved with
`pnpm workspace-key:migrate-local-keychain -- --apply`.

See `docs/TELEGRAM_PERSONAL_ACCOUNT.md` for the local personal-account runbook.

For semantic knowledge search, use `pnpm openai:setup` to store a local OpenAI
API key in macOS Keychain instead of `.env.local`, or configure the knowledge
graph to use local OpenAI-compatible endpoints. Set `AI_PROCESSING_ENABLED=true`
only when external AI vendor egress is intended. General CRM search embeddings
also require `AI_SEARCH_EMBEDDINGS_ENABLED=true`.

The easiest fully local knowledge-graph path is the Nomic preset, with Qwen
available as a heavier advanced option:

```bash
pnpm local-ai:setup:nomic
# or
pnpm local-ai:setup:qwen
```

Then run `pnpm kg:local:smoke` after Ollama is running. The knowledge graph
database schema expects 512-dimensional embeddings, so local embedding endpoints
must return 512 values. If you switch embedding presets later, re-embed the
knowledge graph before trusting semantic search quality.
ChatGPT OAuth is not a supported general API credential path for this app today;
see `docs/OPENAI_LOCAL_SETUP.md`.

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
pnpm setup:local
pnpm demo:setup
pnpm demo:smoke
pnpm dev
```

`pnpm setup:local` creates `.env.local` from `.env.example` and generates random local-only auth/internal secrets without printing them. `pnpm demo:setup` starts loopback-bound Postgres/Redis, applies SQL migrations, and seeds synthetic demo workspaces. It refuses nonlocal Postgres or Redis URLs unless `ALLOW_NONLOCAL_DEMO_TARGETS=true` is set intentionally. Telegram stays disabled.

`pnpm demo:smoke` installs the Chromium test browser if needed and runs the seeded demo Playwright smoke test with the same local-safe environment used by CI.

For a fresh local database without sample accounts, create the first invite-capable
workspace owner explicitly:

```bash
pnpm db:migrate
pnpm bootstrap:local-owner -- --email you@example.local --name "Your Name"
pnpm --dir apps/web dev
```

`pnpm bootstrap:local-owner` refuses nonlocal database targets and refuses to run
after users already exist unless `--allow-existing-users` is passed for an
intentional local repair. Public signup remains disabled; additional users still
come through workspace invite links.

To test a personal Telegram account locally on macOS, create a dedicated
Telegram API app at [my.telegram.org/apps](https://my.telegram.org/apps), then
run:

```bash
pnpm telegram:setup
pnpm telegram:doctor
pnpm telegram:security-smoke
```

The setup wizard shows known-good app form values, hides `api_id` / `api_hash`
while typed, and stores them in macOS Keychain by default. `.env.local` keeps
only the Keychain account marker and Telegram safety flags.

Do not proceed past the onboarding connect step until the doctor reports zero
failures. The command intentionally fails if Telegram send capability is enabled,
AWS credentials are active for the local session-key path, or Postgres/Redis are
not local endpoints. After importing data, run `pnpm telegram:security-smoke`
again to verify Keychain custody, fail-closed send behavior, encrypted database
storage, and volatile Redis residue without printing secret values.

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
pnpm audit
pnpm audit --prod
pnpm security:local-runtime-smoke
pnpm telegram:doctor --allow-missing-credentials
pnpm telegram:security-smoke --allow-missing-credentials --skip-db --skip-redis --skip-worker
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
- [docs/RELEASE_ATTESTATION.md](docs/RELEASE_ATTESTATION.md) - sign-off record for provider rotation, runtime cleanup, GitHub settings, and final release validation.
- [docs/PUBLIC_STATUS.md](docs/PUBLIC_STATUS.md) - what is deleted, down, disabled, or still needs cleanup.
- [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md) - release checklist and Telegram threat model.
- [docs/SECURITY_NOTES.md](docs/SECURITY_NOTES.md) - current public security posture.
- [docs/OPENAI_LOCAL_SETUP.md](docs/OPENAI_LOCAL_SETUP.md) - local OpenAI API key setup with macOS Keychain.
- [docs/LOCAL_KG_MODELS.md](docs/LOCAL_KG_MODELS.md) - local Nomic KG model setup.
- [docs/DATA_CLASSIFICATION.md](docs/DATA_CLASSIFICATION.md) - encrypted fields, plaintext metadata, embeddings, runtime queues, logs, and third-party provider boundaries.
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
- run `pnpm audit`;
- run `pnpm audit --prod`;
- run `pnpm check:publication` after the repository is public and GitHub-side settings are available;
- rename or remove all example deployment app names, volume names, and tokens;
- keep deployment workflows manual/check-only until new open-source infrastructure is created;
- use mock or synthetic data for demos.

## License

MIT. See [LICENSE](LICENSE).

# Public Status

Gordian v2 is being prepared to be shared as an experimental, unhosted codebase.

## Repository Visibility

The source repository and selected publication mirror are private until a
release owner intentionally makes the mirror public. Treat
`0xLLM73/gordian-v2` as the current source of truth. Publish
`0xLLM73/gordian-v2-public` only after it has been synced as a sanitized release
tree and all release gates have been rerun against that checkout.

As of the 2026-06-10 PT release-target refresh, the mirror remains private and
is still the selected publication target. The 2026-06-08 mirror evidence is now
historical: PR #36 merged a sanitized snapshot from source commit
`fe97ac196451` into mirror `main` at `be88d03dbcc1`, then PR #37 refreshed
docs-only evidence and moved mirror `main` to `32662038aa69`. That mirror
checkout passed `pnpm install --frozen-lockfile`, `pnpm audit:open-source`,
`pnpm audit`, `pnpm audit --prod`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm demo:smoke`, and `pnpm security:local-runtime-smoke`; after PR #37
merged, mirror `main` passed `pnpm audit:open-source`, `pnpm audit`, `pnpm
audit --prod`, `pnpm lint`, and `pnpm security:local-runtime-smoke` again.
GitHub CI for PR #36 passed `validate`, `demo-smoke`, and `postgres-smoke`;
GitHub CI for PR #37 passed `validate` and `demo-smoke`.

Before publication, resync `0xLLM73/gordian-v2-public` from the final selected
private source release commit, rerun full-history scanning and release gates
against the mirror, and keep the mirror private unless that evidence is clean.
If full-history scanning finds real secrets, private user data, or private
operational context in the mirror, publish from a fresh sanitized repository
instead. Do not make the mirror public until provider-side rotation/cleanup and
final sign-off are complete.

The previous mirror default branch reported 4 moderate Hono advisories because
it pinned `hono 4.12.18`. Merged mirror `main` now pins `hono 4.12.23`, which
is above the patched `4.12.21` floor, and passes both `pnpm audit` and `pnpm
audit --prod`. The GitHub Dependabot alerts API still returns 404 while the
mirror remains private, so recheck in GitHub before publication.

## What Is Not Live

- The original Telegram bot has been deleted.
- The old website is not running.
- The old worker infrastructure is not running.
- The old DragonflyDB/Redis infrastructure is not running.
- No production deployment is included in this repository.
- Checked-in deployment configs are examples only and must be renamed before use.

## What Remains In The Repo

The repository still contains the source code for the web app, worker, database schema, encryption helpers, AI queues, and Telegram integration. Private historical planning docs and runbooks are excluded from the release snapshot. Telegram integration code remains for reference and possible future demo use, but all Telegram features are disabled by default in the release configuration.

## Public Feature Matrix

This matrix describes a fresh public mirror checkout using the safe defaults from
`.env.example` and `pnpm setup:local`. It is intentionally conservative: code may
exist for a feature, but the runtime will not touch real Telegram or private
message content until the operator explicitly enables the required gates.

| Feature area | Public default | Automatic? | What must be turned on |
| --- | --- | --- | --- |
| Local demo login | Enabled only for generated local demo data | Manual sign-in | `pnpm setup:local`, `pnpm demo:setup`, local seeded credentials |
| Real Telegram linking | Disabled | No | `TELEGRAM_MTPROTO_ENABLED=true`, `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED=true`, throwaway Telegram API credentials |
| Telegram history import | Disabled | No | MTProto enabled, Telegram consent, selected linked account, import confirmation |
| Telegram sends | Disabled | No | `TELEGRAM_SEND_ENABLED=true` after send confirmation, audit, and rate-limit review |
| Periodic Telegram sync | Disabled | No | `TELEGRAM_PERIODIC_SYNC_ENABLED=true`; not recommended for personal accounts |
| Post-import AI analysis | Disabled until local AI plus consent | Automatic after manual import only when enabled | Local AI setup, AI analysis consent, contact-linked newly imported messages |
| Search | Exact/local search; semantic off | No | `AI_SEARCH_EMBEDDINGS_ENABLED=true` plus local or approved embedding runtime |
| Knowledge graph | Existing demo data only | No | `KNOWLEDGE_EXTRACTION_ENABLED=true` or `knowledge_extraction` flag, local embeddings, AI consent |
| Digest generation | Disabled by consent/runtime | No | AI consent plus local Qwen/chat fallback or approved cloud runtime |
| Chat assistant | Disabled by consent/runtime | No | AI consent plus local Qwen/chat config or approved cloud runtime |
| Commitment extraction | Disabled by consent/runtime | Runs only from sync/import analysis when enabled | AI consent, local Qwen commitment runtime, local embeddings |
| Introductions and relationships | Manual records only | No | Current automatic detector uses the older cloud inference path; add a local extractor before enabling for personal data |
| Recommendations | Disabled | No | `recommendations` feature flag plus morning-brief scheduling |
| Morning brief and notifications | Bot disabled | No | New test bot token, `TELEGRAM_BOT_ENABLED=true`, user preferences |
| Google Calendar | Unconfigured | No | Google OAuth credentials and explicit connection |
| Export and deletion | Manual only | No | Authenticated user action |

For public users, the recommended path is still synthetic demo data first. Real
Telegram testing should use a throwaway Telegram account, a fresh local database,
local Keychain-backed session custody, outbound sending disabled, and local AI
models only.

## Local Demo

The release snapshot has a synthetic local demo path that does not use Telegram:

```bash
pnpm install --frozen-lockfile
pnpm setup:local
pnpm demo:setup
pnpm dev
```

`pnpm setup:local` creates `.env.local` with random local-only internal secrets. Sign in with `alice@gordian.dev` and the local `SEED_PASSWORD` value from `.env.local`.

Public email signup is disabled. Additional local users must be created from a workspace invite link generated by the workspace owner.

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

The purge command loads `.env.local` by default and clears Telegram MTProto session ciphertext, account tokens, Better Auth sessions, verification values, calendar OAuth tokens, volatile Telegram Redis keys, and local BullMQ/session residue. It refuses nonlocal DB/cache targets unless `ALLOW_NONLOCAL_RUNTIME_PURGE=true` is set intentionally.

In-app export is currently a basic CRM JSON export. It includes contacts,
active commitments, and deals only. It is labeled as such in the API response
and filename because it is not a full archive of Telegram messages, AI-derived
data, embeddings, audit logs, Redis state, or BullMQ queue payloads.

## Public Sharing Checklist

- Confirm the repository contains no real `.env` files.
- Confirm GitHub Actions has no deployment secrets for old infrastructure.
- Confirm old provider dashboards no longer hold `BOT_TOKEN`, `TELEGRAM_API_ID`, or `TELEGRAM_API_HASH`.
- Confirm old DB/Redis snapshots are deleted or purged.
- Confirm any example deployment config has new app names, volume names, endpoints, and secrets for the fork.
- Keep Telegram flags disabled in `.env.example`.
- Choose the publication target and confirm it is synced to the selected release commit.
- Confirm the mirror PR has the required human approval and no unresolved
  Dependabot alerts on `main` after merge.
- Run `pnpm check:publication` from the mirror checkout, or
  `GORDIAN_PUBLICATION_REPO=0xLLM73/gordian-v2-public pnpm check:publication`
  from the private source checkout, after the selected target is public and
  GitHub-side security settings are available.

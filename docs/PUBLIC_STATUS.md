# Public Status

Gordian v2 is being prepared to be shared as an experimental, unhosted codebase.

## Repository Visibility

The source repository and selected publication mirror are private until a
release owner intentionally makes the mirror public. Treat
`0xLLM73/gordian-v2` as the current source of truth. Publish
`0xLLM73/gordian-v2-public` only after it has been synced as a sanitized release
tree and all release gates have been rerun against that checkout.

As of the 2026-06-11 PT PR #131 release-safety refresh,
the mirror remains private and is still the selected publication target. The
production app-code release candidate remains
`c110d801ad769040f788820c4c6bfd5dbf56bae0` after source PR #116. Source
`main` is current through later release evidence, docs, tests, guardrails,
onboarding, and local runtime hardening PRs #117 through #130 at `8dfc5725`.
PR #131 is the current batched release-safety/onboarding update under review.
Mirror PR #38 synced the production app-code release candidate into the mirror and merged at
`44e3dd0a4df5de5e6a2a030a5952810f6ccc6555`; mirror PRs #39 through #48 then
synced later release evidence, docs, and test-only changes, and mirror PR #50
batched source PR #128 docs plus source PR #129 artifact guardrails through
mirror `main` `7eaae458`. Historical mirror PRs #36 and #37 remain evidence for the
earlier sanitized snapshot and docs-only refresh.

Before publication, ensure the mirror also includes source PR #130 and PR #131,
rerun full-history scanning and release
gates against the mirror, and keep the mirror private unless that evidence is
clean. If full-history scanning finds real secrets, private user data, or
private operational context in the mirror, publish from a fresh sanitized
repository instead. Do not make the mirror public until provider-side
rotation/cleanup and final sign-off are complete. Batch future attestation
updates with final sign-off, provider/runtime decisions, publication-setting
changes, or other meaningful release-gate changes instead of creating one PR
per evidence checkpoint.

The previous mirror default branch reported 4 moderate Hono advisories because
it pinned `hono 4.12.18`. Merged mirror `main` now pins `hono 4.12.23`, which
is above the patched `4.12.21` floor, and passes both `pnpm audit` and `pnpm
audit --prod`. On 2026-06-10 PT, source and mirror GitHub
vulnerability-alert endpoints returned 204 and automated security fixes were
enabled and unpaused. Earlier open Dependabot alert queries returned `[]`;
post-PR #45 alert-list API calls returned 404 while the repos remain private.
On 2026-06-11 PT, source and mirror vulnerability-alert endpoints still returned
204 and automated security fixes were still enabled and unpaused. Re-check alert
lists after the public flip.

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

For a fresh local database without sample accounts, run `pnpm db:migrate` and
`pnpm bootstrap:local-owner -- --email you@example.local --name "Your Name"` to
create the first local workspace owner. The command refuses nonlocal database
targets and refuses to run after users already exist unless
`--allow-existing-users` is passed for an intentional local repair.

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

The purge command loads `.env.local` by default and clears Telegram MTProto
session ciphertext, account tokens, Better Auth sessions, verification values,
calendar OAuth tokens, volatile Telegram Redis keys, and local BullMQ/session
residue. It refuses nonlocal DB/cache targets unless
`ALLOW_NONLOCAL_RUNTIME_PURGE=true` is set intentionally. It does not delete
imported message rows, contacts, chats, knowledge, memories, deals,
commitments, audit rows, or other workspace data. If old runtime databases or
backups contain real imported data, delete/reset those stores, use the explicit
workspace deletion path, or record that the local runtime is intentionally out
of public-release scope.

In-app export is currently a basic CRM JSON export. It includes contacts,
active commitments, and deals only. It is labeled as such in the API response
and filename because it is not a full archive of Telegram messages, AI-derived
data, embeddings, audit logs, Redis state, or BullMQ queue payloads.

## Public Sharing Checklist

- Confirm the repository contains no real `.env` files.
- Confirm GitHub Actions has no deployment secrets for old infrastructure.
- Confirm old provider dashboards no longer hold `BOT_TOKEN`, `TELEGRAM_API_ID`, or `TELEGRAM_API_HASH`.
- Confirm old DB/Redis snapshots are deleted, reset, fully workspace-deleted,
  or explicitly accepted as local-only and out of public-release scope.
- Confirm any example deployment config has new app names, volume names, endpoints, and secrets for the fork.
- Keep Telegram flags disabled in `.env.example`.
- Choose the publication target and confirm it is synced to the selected release commit.
- Confirm the mirror includes the latest source evidence docs and has no
  unresolved Dependabot alerts on `main` after merge.
- Run `pnpm check:publication` from the mirror checkout, or
  `GORDIAN_PUBLICATION_REPO=0xLLM73/gordian-v2-public pnpm check:publication`
  from the private source checkout, after the selected target is public and
  GitHub-side security settings are available.

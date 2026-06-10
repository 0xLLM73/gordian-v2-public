# Release Attestation

Use this document as the final sign-off record before announcing a public
release. The repository checks prove the current code path; these items cover
provider dashboards, local machines, databases, caches, and backups that the
repository cannot inspect.

Do not paste secrets, tokens, session strings, database URLs, or raw customer
data into this file. Record only status, date, owner, and short evidence notes.

## Release Candidate

| Field | Value |
| --- | --- |
| Release candidate commit | PENDING - replace with the final post-publication-gate source `main` commit before mirror sync |
| Validated source baseline | `c526ac24bdbf8bd7dc418059dbeb58b22cd7bb3f` after PRs #108 through #115 merged |
| Source repository | `0xLLM73/gordian-v2` |
| Release-control accounts | `@0xLLM73` and `@thegrovest` |
| Attestation owner | Zachary Grove using the `@0xLLM73` and `@thegrovest` release-control accounts, assisted by Codex |
| Attestation date | 2026-06-10 PT |
| Publication target | `0xLLM73/gordian-v2-public`; private mirror `main` is still at historical commit `32662038aa698ddbf8e740d9c9ba6c6d85dd677e` and must be resynced from the final source release commit before publication |

This is a readiness attestation, not a final public-release approval. The mirror
remains private. The existing public mirror remains the selected target because
the release docs, check scripts, and GitHub links already point at it. Source
validation is materially stronger after PRs #108 through #115, but this is not a
release approval: the mirror is not synchronized to the validated source
baseline, the mirror is not public, GitHub public-security settings are not yet
available, provider-side rotation is not signed off, runtime cleanup is not
signed off, and final release owner/security/runtime sign-offs are still
pending. If the next full-history mirror scan finds real secrets, private user
data, or private operational context, publish from a fresh sanitized repository
instead of keeping the current mirror history.

## Repository Validation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Clean checkout | `git status --short --branch` shows a clean release branch | PASS | 2026-06-10 PT: `git status --short --branch` showed clean `codex/final-publication-gate` at source baseline `c526ac24bdbf8bd7dc418059dbeb58b22cd7bb3f` before this attestation update. |
| Frozen install | `pnpm install --frozen-lockfile` passes | PASS | 2026-06-10 PT: lockfile was up to date and install completed successfully. |
| Dependency audit | `pnpm audit` and `pnpm audit --prod` pass | PASS | 2026-06-10 PT: both commands reported `No known vulnerabilities found` when run with registry access. |
| Open-source audit | `pnpm audit:open-source` passes on a full-depth checkout | PASS | 2026-06-10 PT: `Open-source audit passed.` Rerun against the resynced mirror before publication. |
| Lint | `pnpm lint` passes | PASS | 2026-06-10 PT: Biome checked 925 files with no fixes required. |
| Typecheck | `pnpm typecheck` passes | PASS | 2026-06-10 PT: Turbo reported 8 successful typecheck/build tasks. |
| Tests | `pnpm test` passes | PASS | 2026-06-10 PT: Turbo reported 8 successful test tasks; package summaries included 8 crypto files/79 tests, 7 shared files/45 tests, 99 worker files/1201 tests, and 100 web files/529 tests. Worker tests emitted local Redis connection stderr in the sandbox but completed green. |
| Demo setup | `pnpm demo:setup` can prepare synthetic local services and seed data | PARTIAL | 2026-06-10 PT: `pnpm demo:setup` passed `demo:guard` but could not start compose Postgres/Redis because user-owned local services were already bound to `127.0.0.1:5432` and `127.0.0.1:6379`. Equivalent local validation continued against those local services: `pnpm db:migrate` passed, `pnpm seed:demo` passed, and seeded data printed no raw WRK. |
| Demo smoke | `pnpm demo:smoke` passes with synthetic demo data | PASS | 2026-06-10 PT: 7 Playwright smoke tests passed. |
| Release browser smoke | `pnpm demo:release-smoke` passes with synthetic demo data | PASS | 2026-06-10 PT: 31 Playwright release-route checks passed across desktop and mobile. The run included settings, audit, search, knowledge, follow-up plans, deal detail, onboarding, and mobile dense routes with sensitive-leak guards. |
| Local runtime safety | `pnpm security:local-runtime-smoke` passes | PASS | 2026-06-10 PT: local runtime safety smoke passed. |
| Telegram local security smoke | `pnpm telegram:security-smoke --allow-missing-credentials --skip-db --skip-redis --skip-worker` passes | PARTIAL | 2026-06-10 PT: elevated run completed with 0 failures and 4 warnings. Warnings were intentional skipped Telegram API credential presence, worker route, Postgres residue, and Redis residue checks; credentialed/full-service Telegram release sign-off is still pending. |
| Derived data audit | `pnpm security:derived-data-audit` passes | PASS | 2026-06-10 PT: 17 plain derived columns, 73 plain derived rows, 9 vector columns, and 41 populated vector rows checked with 0 violations. |
| Knowledge security audit | `pnpm kg:security:audit` passes | PASS | 2026-06-10 PT: audit completed with 0 violations. The seeded database had no plaintext-shaped knowledge leaks in the checked surfaces. |
| Local AI readiness | `pnpm local-ai:doctor` and `pnpm kg:local:smoke` pass | PASS | 2026-06-10 PT: temporary Ollama server exposed installed `nomic-embed-text`, `llama3.1:8b`, and `qwen3.5:9b`; doctor had 0 failures; KG smoke confirmed 512-dimension Nomic embeddings, llama KG extraction, and Qwen commitment/chat/digest paths. |
| Publication check | `pnpm check:publication --repo 0xLLM73/gordian-v2-public` passes after the repo is public | BLOCKED | 2026-06-10 PT: failed as expected because the selected mirror is private; secret scanning and push protection are unavailable; private vulnerability reporting returns 404. Rerun after the sanitized mirror is synced, intentionally made public, and GitHub-side settings are enabled. |

## GitHub Settings

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Repository visibility | Repository is public only when intentionally ready | PASS | The selected mirror was confirmed private on 2026-06-10 PT; keep it private until the sanitized release tree, provider rotation, runtime cleanup, and human sign-off are complete. |
| Secret scanning | Enabled | BLOCKED | 2026-06-10 PT: `pnpm check:publication --repo 0xLLM73/gordian-v2-public` reports secret scanning unavailable while the mirror remains private. Re-run after intentional publication. |
| Push protection | Enabled | BLOCKED | 2026-06-10 PT: `pnpm check:publication --repo 0xLLM73/gordian-v2-public` reports push protection unavailable while the mirror remains private. Re-run after intentional publication. |
| Private vulnerability reporting | Enabled | BLOCKED | 2026-06-10 PT: GitHub API returns 404 while the mirror remains private. Re-run after intentional publication and enable private vulnerability reporting. |
| Dependabot alerts | Enabled | NEEDS REVIEW | The stale mirror default-branch Hono advisories were resolved by merging PR #36. Merged mirror `main` pins `hono 4.12.23` and passes `pnpm audit` plus `pnpm audit --prod`; the Dependabot alerts API still returns 404 while the mirror remains private, so recheck in GitHub before publication. |
| Dependabot security updates | Enabled and unpaused | NEEDS REVIEW | Confirm in GitHub settings before publication. |
| Branch checks | `main` requires strict `validate` and `demo-smoke` checks | PASS | Source and mirror `main` require strict `validate` and `demo-smoke` checks. |
| Review policy | `main` requires owner approval before merge | NEEDS REVIEW | Source and mirror `main` had one-approval branch protection on 2026-06-08 PT. `.github/CODEOWNERS` now assigns all paths to `@0xLLM73` and `@thegrovest`; verify GitHub branch protection requires CODEOWNER review before publication. |
| Protected history | `main` blocks force pushes and deletion, enforces admins and linear history | PASS | Source and mirror branch protection confirms admins enforced, linear history required, force pushes blocked, deletions blocked, and conversation resolution required. |

## Ongoing Regression System

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Every PR gate | CI runs open-source audit, package audits, lint, typecheck, tests, and demo smoke before merge | PASS | PRs #108 through #115 merged only after required review and green CI; PR #115 final checks passed `validate`, `postgres-smoke`, and `demo-smoke` before merge. |
| Release browser QA matrix | Full route matrix is run for each release candidate and evidence is recorded here | PASS | 2026-06-10 PT: `pnpm demo:release-smoke` passed 31 desktop/mobile route checks. In-app browser subset on `http://localhost:3456` also loaded settings, audit log, search, knowledge, follow-up plans, follow-up wizard deep link, deal detail, and onboarding connect with no fresh console errors or secret-pattern leaks after local workspace keys were migrated to os-keychain markers. Repeat after mirror sync. |
| Weekly publication review | Publication readiness, Dependabot, secret scanning, push protection, vulnerability reporting, and branch protection are reviewed | PENDING | Begin after the mirror is public and GitHub-side settings are available. |
| Monthly sensitive-data review | Data classification, exports, AI egress, logging/audit, Telegram safety, and runtime purge coverage are reviewed | PENDING | Begin after public release; record accepted risks with owner and date. |

## Provider And Secret Rotation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Telegram bot token | Deleted or rotated in BotFather | TODO | TODO |
| Telegram API app credentials | Old app credentials retired or confirmed unused | TODO | TODO |
| Telegram user sessions | Real sessions connected to this project revoked in Telegram clients | TODO | TODO |
| Deployment provider secrets | Old Telegram, database, worker, auth, and AI secrets removed | TODO | TODO |
| Database credentials | Postgres/Supabase URLs and passwords rotated where real values existed | TODO | TODO |
| Supabase keys | Anon and service keys rotated where real values existed | TODO | TODO |
| AWS and KMS credentials | Access keys and KMS-related credentials rotated where real values existed | TODO | TODO |
| AI provider keys | OpenAI, Anthropic, Gemini, local proxy, and similar keys rotated where used | TODO | TODO |
| Observability keys | Logging, tracing, error reporting, and metrics keys rotated where used | TODO | TODO |
| GitHub Actions secrets | No stale deployment or provider secrets remain | TODO | TODO |

## Runtime Data And Backup Cleanup

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Runtime purge | `pnpm purge:secrets` run where old real runtime state existed | TODO | TODO |
| Postgres snapshots | Old snapshots/backups deleted or confirmed free of raw secrets | TODO | TODO |
| Redis/Dragonfly residue | Old cache/job/session data purged or confirmed absent | TODO | TODO |
| Local developer machines | Old `.env.local`, Telegram sessions, and local DB/cache residue cleaned | PARTIAL | 2026-06-10 PT: seeded local workspace WRKs were migrated to macOS Keychain markers with `pnpm workspace-key:migrate-local-keychain -- --apply` so browser QA could run under `WORKSPACE_KEY_PROVIDER=os-keychain`. Broader `.env.local`, Telegram session, DB/cache, and backup cleanup still needs human sign-off. |
| Legacy key material | No known raw workspace keys, Telegram session keys, or KMS context secrets remain | TODO | TODO |

## Telegram Local Safety

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Send disabled | `TELEGRAM_SEND_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Backfill disabled | `TELEGRAM_FULL_BACKFILL_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Periodic sync disabled | `TELEGRAM_PERIODIC_SYNC_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Keychain custody | Real local macOS workspaces use `os-keychain` providers | PASS | Documented in `docs/OPEN_SOURCE.md`, `docs/PUBLIC_STATUS.md`, and `docs/MACOS_TOUCH_ID_MTPROTO.md`; local personal-account testing uses explicit per-import unlock. |
| Telegram smoke | `pnpm telegram:security-smoke` passes against the intended local environment | PARTIAL | 2026-06-10 PT: skipped-service local smoke passed with 0 failures and 4 warnings. Credentialed Telegram API presence, worker send-disabled route, Postgres residue scan, and Redis residue scan remain pending before any real-account release test. |
| Purged-runtime smoke | `pnpm telegram:security-smoke --expect-purged` passes where runtime purge was required | PENDING | Requires provider/runtime cleanup first; do before any public announcement. |

## Final Sign-Off

| Role | Decision | Date | Notes |
| --- | --- | --- | --- |
| Release owner | TODO | TODO | Zachary Grove using `@0xLLM73` after final release gates pass. |
| Security reviewer | TODO | TODO | Zachary Grove using the separate `@thegrovest` release-control account after reviewing secret scanning, provider rotation, AI egress, Telegram safety, and browser QA evidence. |
| Runtime reviewer | TODO | TODO | Zachary Grove must confirm provider dashboards, local machines, databases, Redis/Dragonfly, backups, and old Telegram sessions are purged or intentionally out of scope. |

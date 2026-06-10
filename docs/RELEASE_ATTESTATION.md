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
| Release candidate commit | Code release candidate `c110d801ad769040f788820c4c6bfd5dbf56bae0` after PR #116 merged; evidence-only docs were refreshed afterward without app-code changes |
| Validated source baseline | App-code baseline remains `c110d801ad769040f788820c4c6bfd5dbf56bae0`; source `main` is current through evidence-only PRs #117, #118, #119, #120, and #121 at `d33c5b1fb51c19edbc7a38668f3140d7c80901a4` |
| Source repository | `0xLLM73/gordian-v2` |
| Release-control accounts | `@0xLLM73` and `@thegrovest` |
| Attestation owner | Zachary Grove using the `@0xLLM73` and `@thegrovest` release-control accounts, assisted by Codex |
| Attestation date | 2026-06-10 PT |
| Publication target | `0xLLM73/gordian-v2-public`; private mirror PR #38 synced source commit `c110d801ad769040f788820c4c6bfd5dbf56bae0`, and mirror PRs #39, #40, #41, and #42 synced later evidence-only release docs through mirror `main` `9952507` after green CI and required `@thegrovest` review |

This is a readiness attestation, not a final public-release approval. The mirror
remains private. The existing public mirror remains the selected target because
the release docs, check scripts, and GitHub links already point at it. Source
validation is materially stronger after PRs #108 through #116, source PRs #117
through #121 are evidence-only documentation updates, and mirror PRs #38 through
#42 reran the required gates from the mirror checkout before merge, but this is
not a release approval: the mirror remains private, GitHub public-security
settings are not yet available, provider-side rotation is not signed off,
runtime cleanup is not signed off, and final release owner/security/runtime
sign-offs are still pending. Any later source evidence-only changes must be
mirrored before publication. If the full-history mirror scan finds real secrets,
private user data, or private operational context, publish from a fresh
sanitized repository instead of keeping the current mirror history.

## Repository Validation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Clean checkout | `git status --short --branch` shows a clean release branch | PASS | 2026-06-10 PT: source `main` was clean and synced to `origin/main` at `d33c5b1fb51c19edbc7a38668f3140d7c80901a4`; mirror `main` was clean and synced to `origin/main` at `9952507`. |
| Frozen install | `pnpm install --frozen-lockfile` passes | PASS | 2026-06-10 PT: lockfile was up to date and install completed successfully. |
| Dependency audit | `pnpm audit` and `pnpm audit --prod` pass | PASS | 2026-06-10 PT: both commands reported `No known vulnerabilities found` when run with registry access. |
| Open-source audit | `pnpm audit:open-source` passes on a full-depth checkout | PASS | 2026-06-10 PT: `Open-source audit passed` on the source release candidate and on the mirror PR #38 checkout. |
| Lint | `pnpm lint` passes | PASS | 2026-06-10 PT: Biome checked the source and mirror release trees with no fixes required. |
| Typecheck | `pnpm typecheck` passes | PASS | 2026-06-10 PT: Turbo reported 8 successful typecheck/build tasks. |
| Tests | `pnpm test` passes | PASS | 2026-06-10 PT: Turbo reported 8 successful test tasks; package summaries included 8 crypto files/79 tests, 7 shared files/45 tests, 99 worker files/1201 tests, and 100 web files/529 tests. Worker tests emitted local Redis connection stderr in the sandbox but completed green. |
| Demo setup | `pnpm demo:setup` can prepare synthetic local services and seed data | PARTIAL | 2026-06-10 PT: source and mirror `demo:setup` passed `demo:guard` but could not start compose Postgres/Redis because user-owned local services were already bound to `127.0.0.1:5432` and `127.0.0.1:6379`. Equivalent validation continued with `pnpm db:migrate` and `pnpm seed:demo`; mirror browser validation used isolated local database `gordian_release_mirror_c110d80_20260610a`. |
| Demo smoke | `pnpm demo:smoke` passes with synthetic demo data | PASS | 2026-06-10 PT: source Playwright demo smoke passed 7 checks. Mirror PR #38 ran the same browser spec directly against the isolated local database and passed 7 checks; GitHub `demo-smoke` also passed on PR #38. |
| Release browser smoke | `pnpm demo:release-smoke` passes with synthetic demo data | PASS | 2026-06-10 PT: source and mirror isolated-DB release smoke passed 31 desktop/mobile route checks with sensitive-leak guards. After local demo reseed, `pnpm workspace-key:migrate-local-keychain -- --apply` migrated 3 seeded WRKs and the fallback Playwright matrix passed 31/31 with public-release Telegram flags forced off. The route set included settings, audit, search, knowledge, follow-up plans, follow-up wizard deep link, deal detail, onboarding, and mobile dense routes. |
| Local runtime safety | `pnpm security:local-runtime-smoke` passes | PASS | 2026-06-10 PT: local runtime safety smoke passed. |
| Telegram local security smoke | `pnpm telegram:security-smoke --allow-missing-credentials` passes against local DB/Redis | PARTIAL | 2026-06-10 PT: skipped-credential local smoke completed with 0 failures and 2 warnings after moving 3 local workspace WRKs to macOS Keychain markers. After browser QA reseeded demo data, `pnpm workspace-key:migrate-local-keychain -- --apply` migrated the 3 seeded WRKs again. A follow-up smoke with the local worker running and the probe header aligned to `WORKER_INTERNAL_SECRET` without printing the secret passed with 0 failures and 1 warning; the worker `send-message` route returned 503 while `TELEGRAM_SEND_ENABLED=false`. DB and Redis residue scans passed. Remaining warning is skipped Telegram API Keychain credential presence. Mirror PR #38 used temporary nontracked env `/private/tmp/gordian-mirror-telegram-smoke.env`. |
| Derived data audit | `pnpm security:derived-data-audit` passes | PASS | 2026-06-10 PT: source and mirror isolated-DB audits completed with 0 violations. Mirror checked 17 plain derived columns, 72 plain derived rows, 9 vector columns, and 40 populated vector rows. |
| Knowledge security audit | `pnpm kg:security:audit` passes | PASS | 2026-06-10 PT: source and mirror isolated-DB audits completed with 0 violations. The seeded databases had no plaintext-shaped knowledge leaks in the checked surfaces. |
| Local AI readiness | `pnpm local-ai:doctor` and `pnpm kg:local:smoke` pass | PASS | 2026-06-10 PT: source validated local AI readiness, and mirror PR #38 validated Qwen local AI through temporary nontracked env `/private/tmp/gordian-mirror-local-ai.env`; doctor had 0 failures and 0 warnings, `qwen3-embedding:0.6b` returned 512 dimensions, and `qwen3.5:9b` handled commitment extraction, chat assistant, and digest generation. Temporary Ollama was stopped after validation. |
| Publication check | `pnpm check:publication --repo 0xLLM73/gordian-v2-public` passes after the repo is public | BLOCKED | 2026-06-10 PT: post-PR #42 mirror check failed as expected because the selected mirror is private; secret scanning and push protection are unavailable; private vulnerability reporting returns 404. Rerun after the sanitized mirror is synced, intentionally made public, and GitHub-side settings are enabled. |

## GitHub Settings

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Repository visibility | Repository is public only when intentionally ready | PASS | The selected mirror was confirmed private on 2026-06-10 PT; keep it private until the sanitized release tree, provider rotation, runtime cleanup, and human sign-off are complete. |
| Secret scanning | Enabled | BLOCKED | 2026-06-10 PT: `pnpm check:publication --repo 0xLLM73/gordian-v2-public` reports secret scanning unavailable while the mirror remains private. Re-run after intentional publication. |
| Push protection | Enabled | BLOCKED | 2026-06-10 PT: `pnpm check:publication --repo 0xLLM73/gordian-v2-public` reports push protection unavailable while the mirror remains private. Re-run after intentional publication. |
| Private vulnerability reporting | Enabled | BLOCKED | 2026-06-10 PT: GitHub API returns 404 while the mirror remains private. Re-run after intentional publication and enable private vulnerability reporting. |
| Dependabot alerts | Enabled | PASS | 2026-06-10 PT: source and mirror Dependabot vulnerability-alert endpoints returned 204, open alert queries returned `[]`, and merged mirror `main` pins `hono 4.12.23` while passing `pnpm audit` plus `pnpm audit --prod`. |
| Dependabot security updates | Enabled and unpaused | PASS | 2026-06-10 PT: source and mirror automated-security-fixes endpoints returned `{"enabled":true,"paused":false}`. |
| Branch checks | `main` requires strict `validate` and `demo-smoke` checks | PASS | Source and mirror `main` require strict `validate` and `demo-smoke` checks. Mirror PRs #38, #39, #40, #41, and #42 passed GitHub `validate` and `demo-smoke`; PR #38 also passed `postgres-smoke`. |
| Review policy | `main` requires owner approval before merge | PASS | 2026-06-10 PT: source and mirror branch protection require CODEOWNER review with one approval, dismiss stale reviews, enforce admins, require linear history, block force pushes, and block deletions. Mirror PRs #38 through #42 stayed blocked until required `@thegrovest` review landed, then merged cleanly. |
| Protected history | `main` blocks force pushes and deletion, enforces admins and linear history | PASS | Source and mirror branch protection confirms admins enforced, linear history required, force pushes blocked, deletions blocked, and conversation resolution required. |

## Ongoing Regression System

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Every PR gate | CI runs open-source audit, package audits, lint, typecheck, tests, and demo smoke before merge | PASS | PRs #108 through #121 merged only after required review and green CI; mirror PRs #38 through #42 merged after required review and green CI. |
| Release browser QA matrix | Full route matrix is run for each release candidate and evidence is recorded here | PASS | 2026-06-10 PT: source and mirror release smoke passed 31 desktop/mobile route checks. In-app Browser could read the current `http://localhost:3456/onboarding/connect` page, which showed local Telegram linking copy and had no captured console issues, but direct in-app navigation to localhost and 127.0.0.1 routes returned `ERR_BLOCKED_BY_CLIENT`; fallback Playwright release smoke was therefore used for the full matrix and passed 31/31 after public-release Telegram flags were forced off. Repeat after any later mirror sync if source changes again before publication. |
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
| GitHub Actions secrets | No stale deployment or provider secrets remain | PASS | 2026-06-10 PT: `gh secret list` returned no repository Actions secrets for source `0xLLM73/gordian-v2` or mirror `0xLLM73/gordian-v2-public`. |

## Runtime Data And Backup Cleanup

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Runtime purge | `pnpm purge:secrets` run where old real runtime state existed | PARTIAL | 2026-06-10 PT: `pnpm purge:secrets -- --dry-run` printed counts only. The latest post-worker-smoke dry-run found 0 Telegram MTProto account sessions/tokens, 0 account OAuth tokens, 3 Better Auth demo sessions, 0 verification values, 0 calendar OAuth tokens, and 0 Telegram/phone/session Redis keys. It found 1919 `{ai-flow}:*` BullMQ runtime keys covered by purge tooling; destructive `--confirm` purge still requires release-owner approval or explicit owner acceptance of this local non-release residue. |
| Postgres snapshots | Old snapshots/backups deleted or confirmed free of raw secrets | TODO | TODO |
| Redis/Dragonfly residue | Old cache/job/session data purged or confirmed absent | PARTIAL | 2026-06-10 PT: dry-run and Telegram smoke found 0 Telegram auth/send/session-lock keys and 0 legacy grammY session keys; 1919 `{ai-flow}:*` BullMQ runtime keys remain and are covered by purge tooling. Confirmed purge or explicit owner acceptance is still pending. |
| Local developer machines | Old `.env.local`, Telegram sessions, and local DB/cache residue cleaned | PARTIAL | 2026-06-10 PT: `pnpm workspace-key:migrate-local-keychain` dry-run found 3 raw local workspace WRKs, then `pnpm workspace-key:migrate-local-keychain -- --apply` migrated all 3 to macOS Keychain markers. Browser QA reseeding recreated 3 raw demo WRKs, so the migration was rerun and a follow-up Telegram smoke again reported `0 non-Keychain row(s) out of 3`. `.env.local` still exists for local development, and broader local file/backups cleanup still needs human sign-off. |
| Legacy key material | No known raw workspace keys, Telegram session keys, or KMS context secrets remain | PARTIAL | 2026-06-10 PT: local smoke found 0 unsafe Telegram KEK blobs, 0 plaintext-looking Telegram session rows, 0 Telegram OAuth residue rows, and 0 non-Keychain workspace WRK rows. External provider dashboards, local backups, and old snapshots still require human sign-off. |

## Telegram Local Safety

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Send disabled | `TELEGRAM_SEND_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Backfill disabled | `TELEGRAM_FULL_BACKFILL_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Periodic sync disabled | `TELEGRAM_PERIODIC_SYNC_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Keychain custody | Real local macOS workspaces use `os-keychain` providers | PASS | Documented in `docs/OPEN_SOURCE.md`, `docs/PUBLIC_STATUS.md`, and `docs/MACOS_TOUCH_ID_MTPROTO.md`; local personal-account testing uses explicit per-import unlock. |
| Telegram smoke | `pnpm telegram:security-smoke` passes against the intended local environment | PARTIAL | 2026-06-10 PT: `pnpm telegram:security-smoke --allow-missing-credentials` passed with 0 failures and 1 warning after local workspace WRK migration, browser QA reseed, and local worker route verification. The worker send-disabled route returned 503 while `TELEGRAM_SEND_ENABLED=false`. Credentialed Telegram API presence remains pending or must be explicitly accepted as a skipped local-credential check before any real-account release test. |
| Purged-runtime smoke | `pnpm telegram:security-smoke --expect-purged` passes where runtime purge was required | PENDING | Requires provider/runtime cleanup first; do before any public announcement. |

## Final Sign-Off

| Role | Decision | Date | Notes |
| --- | --- | --- | --- |
| Release owner | TODO | TODO | Zachary Grove using `@0xLLM73` after final release gates pass. |
| Security reviewer | TODO | TODO | Zachary Grove using the separate `@thegrovest` release-control account after reviewing secret scanning, provider rotation, AI egress, Telegram safety, and browser QA evidence. |
| Runtime reviewer | TODO | TODO | Zachary Grove must confirm provider dashboards, local machines, databases, Redis/Dragonfly, backups, and old Telegram sessions are purged or intentionally out of scope. |

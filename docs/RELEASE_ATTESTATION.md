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
| Release candidate commit | Code release candidate `c110d801ad769040f788820c4c6bfd5dbf56bae0` after PR #116 merged; release evidence docs and tests were refreshed afterward without production app-code changes |
| Validated source baseline | Production app-code baseline remains `c110d801ad769040f788820c4c6bfd5dbf56bae0`; the public-flip source baseline included release evidence, docs, tests, guardrails, onboarding, local runtime hardening, and key-custody PRs #117 through #131 at `102646b4` |
| Source repository | `0xLLM73/gordian-v2` |
| Release-control accounts | `@0xLLM73` and `@thegrovest` |
| Attestation owner | Zachary Grove using the `@0xLLM73` and `@thegrovest` release-control accounts, assisted by Codex |
| Attestation date | 2026-06-11 PT |
| Publication target | `0xLLM73/gordian-v2-public`; private mirror PR #38 synced source commit `c110d801ad769040f788820c4c6bfd5dbf56bae0`, mirror PRs #39 through #50 synced later release evidence, docs, test-only changes, and artifact guardrails, and mirror PR #51 synced source PRs #130 and #131 through mirror `main` `0d217f4` after green CI and required `@thegrovest` review |

This is the public-release attestation for the unhosted code repository. The
source repository remains private, and the selected mirror
`0xLLM73/gordian-v2-public` is public after the release owner approved the
visibility flip once the sanitized mirror matched source `main`, full-history
and working-tree scans passed, local runtime cleanup was complete, and GitHub
public-security settings were enabled. This attestation does not approve a
hosted production deployment or authorize connecting old provider accounts,
snapshots, or backups to a public service. Any future hosted deployment must
rotate fresh provider credentials and complete a separate runtime/deployment
sign-off.

## Repository Validation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Clean checkout | `git status --short --branch` shows a clean release branch | PASS | 2026-06-11 PT: source `main` was clean and synced to `origin/main` at `102646b4` for the public flip; mirror `main` was clean and synced to `origin/main` at `0d217f4` after mirror PR #51. Mirror tree content matched source `main` through source PR #131 before the docs-only public attestation refresh. |
| Frozen install | `pnpm install --frozen-lockfile` passes | PASS | 2026-06-10 PT: lockfile was up to date and install completed successfully. |
| Dependency audit | `pnpm audit` and `pnpm audit --prod` pass | PASS | 2026-06-11 PT: both commands reported `No known vulnerabilities found` when run with registry access. |
| Open-source audit | `pnpm audit:open-source` passes on a full-depth checkout | PASS | 2026-06-11 PT: `Open-source audit passed` on the full-depth public mirror checkout after mirror PR #51 merged. This includes current-tree checks, AI egress audit, local runtime safety smoke, release regression guard, full-history `gitleaks detect --redact`, and working-tree `gitleaks dir --redact`. |
| Lint | `pnpm lint` passes | PASS | 2026-06-11 PT: Biome checked 935 files with no fixes required after the PR #131 updates. |
| Typecheck | `pnpm typecheck` passes | PASS | 2026-06-11 PT: Turbo reported 8 successful typecheck/build tasks; focused `pnpm --filter web typecheck` and `pnpm --filter @repo/db typecheck` also passed. |
| Tests | `pnpm test` passes | PASS | 2026-06-11 PT: Turbo reported 8 successful test tasks; package summaries included 8 crypto files/79 tests, 7 shared files/45 tests, 100 worker files/1,204 tests, and 104 web files/538 tests, with DB tests also green. Worker tests emitted local Redis connection stderr in the sandbox but completed green. Focused PR #131 tests also passed for local-owner bootstrap, invite workspace id persistence, and onboarding connect copy. |
| Demo setup | `pnpm demo:setup` can prepare synthetic local services and seed data | ACCEPTED | 2026-06-10 PT: source and mirror `demo:setup` passed `demo:guard` but could not start compose Postgres/Redis because user-owned local services were already bound to `127.0.0.1:5432` and `127.0.0.1:6379`. Equivalent validation continued with `pnpm db:migrate` and `pnpm seed:demo`; mirror browser validation used isolated local database `gordian_release_mirror_c110d80_20260610a`. This is accepted as a local port-ownership caveat, not a release blocker. |
| Demo smoke | `pnpm demo:smoke` passes with synthetic demo data | PASS | 2026-06-11 PT: after local demo reseed and migrations, source Playwright demo smoke passed 7 checks. Mirror PR #38 previously ran the same browser spec directly against the isolated local database and passed 7 checks; GitHub `demo-smoke` also passed on PR #38. |
| Release browser smoke | `pnpm demo:release-smoke` passes with synthetic demo data | PASS | 2026-06-11 PT: after local demo reseed and migrations, source release smoke passed 31/31 desktop/mobile route checks with sensitive-leak guards. The route set included settings, audit, search, knowledge, follow-up plans, follow-up wizard deep link, deal detail, onboarding, and mobile dense routes. |
| Non-demo first-owner onboarding | Fresh local databases can create a non-sample owner and invite additional users without public signup | PASS | 2026-06-11 PT: `pnpm bootstrap:local-owner` created a local owner on the reset database, in-app Browser signed in through `/login`, verified dashboard import consent gating, `/settings`, invite management, closed `/signup`, invite-link signup for a second user, and the `/onboarding/connect` key-custody copy. Browser console capture found no route errors in this flow. The local database was reset again afterward for the clean release baseline. |
| Local runtime safety | `pnpm security:local-runtime-smoke` passes | PASS | 2026-06-11 PT: local runtime safety smoke passed after the approved active `gordian_dev` reset and migration rebuild. |
| Telegram local security smoke | `pnpm telegram:security-smoke --allow-missing-credentials` passes against local DB/Redis | ACCEPTED | 2026-06-11 PT: after owner-approved local purge plus active `gordian_dev` reset, `pnpm telegram:security-smoke --allow-missing-credentials --expect-purged` passed with 0 failures and 1 warning while the local worker was running. It verified local-only URLs, Telegram/workspace Keychain split, strict Touch ID request configuration, 0 unsafe Telegram KEK blobs, 0 plaintext-looking Telegram session rows, 0 Telegram OAuth residue, 0 non-Keychain workspace WRK rows, 0 imported message rows, 0 knowledge evidence rows, 0 Redis residue, purge tooling registration, and worker send-disabled route behavior (`send-message` returned 503 while `TELEGRAM_SEND_ENABLED=false`). The warning is accepted because Telegram API credentials are intentionally absent from this unhosted public release; rerun without `--allow-missing-credentials` only for a credentialed real-Telegram test. |
| Derived data audit | `pnpm security:derived-data-audit` passes | PASS | 2026-06-10 PT: source and mirror isolated-DB audits completed with 0 violations. Mirror checked 17 plain derived columns, 72 plain derived rows, 9 vector columns, and 40 populated vector rows. |
| Knowledge security audit | `pnpm kg:security:audit` passes | PASS | 2026-06-10 PT: source and mirror isolated-DB audits completed with 0 violations. The seeded databases had no plaintext-shaped knowledge leaks in the checked surfaces. |
| Local AI readiness | `pnpm local-ai:doctor` and `pnpm kg:local:smoke` pass | PASS | 2026-06-10 PT: source validated local AI readiness, and mirror PR #38 validated Qwen local AI through temporary nontracked env `/private/tmp/gordian-mirror-local-ai.env`; doctor had 0 failures and 0 warnings, `qwen3-embedding:0.6b` returned 512 dimensions, and `qwen3.5:9b` handled commitment extraction, chat assistant, and digest generation. Temporary Ollama was stopped after validation. |
| Publication check | `pnpm check:publication --repo 0xLLM73/gordian-v2-public` passes after the repo is public | PASS | 2026-06-11 PT: check passed after the selected mirror was made public, secret scanning and push protection were enabled, private vulnerability reporting was enabled, Dependabot alerts/security updates were verified, and branch protection was verified. |

## GitHub Settings

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Repository visibility | Repository is public only when intentionally ready | PASS | 2026-06-11 PT: source `0xLLM73/gordian-v2` remains private, and selected mirror `0xLLM73/gordian-v2-public` is public after passing pre-flip scans and owner approval. |
| Secret scanning | Enabled | PASS | 2026-06-11 PT: public mirror `security_and_analysis.secret_scanning.status` is `enabled`; open secret-scanning alert query returned `[]`. |
| Push protection | Enabled | PASS | 2026-06-11 PT: public mirror `security_and_analysis.secret_scanning_push_protection.status` is `enabled`. |
| Private vulnerability reporting | Enabled | PASS | 2026-06-11 PT: enabling private vulnerability reporting returned HTTP 204, and `pnpm check:publication --repo 0xLLM73/gordian-v2-public` passed. |
| Dependabot alerts | Enabled | PASS | 2026-06-11 PT: vulnerability-alert endpoint returned 204 and open Dependabot alert query returned `[]`. |
| Dependabot security updates | Enabled and unpaused | PASS | 2026-06-11 PT: automated-security-fixes endpoint returned `{"enabled":true,"paused":false}`. |
| Branch checks | `main` requires strict `validate` and `demo-smoke` checks | PASS | 2026-06-11 PT: source and mirror `main` require strict `validate` and `demo-smoke` checks. Mirror PRs #38 through #51 passed GitHub `validate` and `demo-smoke`; PRs #38, #51, and source PR #131 also passed `postgres-smoke`. |
| Review policy | `main` requires owner approval before merge | PASS | 2026-06-11 PT: source and mirror branch protection require CODEOWNER review with one approval, dismiss stale reviews, enforce admins, require linear history, block force pushes, and block deletions. Mirror PRs #38 through #51 stayed blocked until required `@thegrovest` review landed, then merged cleanly. |
| Protected history | `main` blocks force pushes and deletion, enforces admins and linear history | PASS | Source and mirror branch protection confirms admins enforced, linear history required, force pushes blocked, deletions blocked, and conversation resolution required. |

## Ongoing Regression System

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Every PR gate | CI runs open-source audit, package audits, lint, typecheck, tests, and demo smoke before merge | PASS | PRs #108 through #131 merged only after required review and green CI; mirror PRs #38 through #51 merged after required review and green CI. |
| Release browser QA matrix | Full route matrix is run for each release candidate and evidence is recorded here | PASS | 2026-06-11 PT: source release smoke passed 31/31 desktop/mobile route checks. In-app Browser also validated the non-demo first-owner and invite signup path against `http://localhost:3000` with no captured console errors. |
| Weekly publication review | Publication readiness, Dependabot, secret scanning, push protection, vulnerability reporting, and branch protection are reviewed | READY | Begin one week after public release; use this attestation as the first public baseline. |
| Monthly sensitive-data review | Data classification, exports, AI egress, logging/audit, Telegram safety, and runtime purge coverage are reviewed | PENDING | Begin after public release; record accepted risks with owner and date. |

## Provider And Secret Rotation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Telegram bot token | Deleted, rotated, or out of public-release scope | PASS | 2026-06-11 PT: docs state the original Telegram bot has been deleted; release defaults keep bot, send, backfill, periodic sync, and MTProto disabled. No bot token is present in `.env.example`, GitHub Actions secrets, open-source audit, or gitleaks results. |
| Telegram API app credentials | Retired, absent, or out of public-release scope | ACCEPTED | 2026-06-11 PT: this is an unhosted code release with Telegram API credentials intentionally absent from `.env.example` and `.env.local` credentialed smoke skipped by design. Operators must use throwaway credentials for local real-account testing. |
| Telegram user sessions | Revoked, absent, or out of public-release scope | PASS | 2026-06-11 PT: active local `gordian_dev` reset plus purged-runtime smoke found 0 Telegram accounts, 0 plaintext-looking Telegram session rows, 0 OAuth residue, and 0 Redis Telegram/session keys. |
| Deployment provider secrets | Removed or out of public-release scope | PASS | 2026-06-11 PT: no production deployment is included, source and mirror GitHub Actions secrets are empty, checked-in infra names are examples, and public defaults do not connect hosted providers. |
| Database credentials | Rotated, absent, or out of public-release scope | ACCEPTED | 2026-06-11 PT: no production database is included in this unhosted release; local `gordian_dev` was reset and `.env.example` contains placeholders only. Rotate fresh database credentials before any hosted deployment. |
| Supabase keys | Rotated, absent, or out of public-release scope | ACCEPTED | 2026-06-11 PT: no Supabase deployment is included in this unhosted release and no Supabase service key is present in repo scans or GitHub Actions secrets. Rotate fresh keys before any hosted deployment. |
| AWS and KMS credentials | Rotated, absent, or out of public-release scope | ACCEPTED | 2026-06-11 PT: no AWS/KMS deployment credential is included in this unhosted release; repo scans and GitHub Actions secrets are clear. Rotate fresh credentials before any hosted deployment. |
| AI provider keys | Rotated, absent, or out of public-release scope | ACCEPTED | 2026-06-11 PT: release defaults are local/off unless configured, AI egress audit passed, and no provider key is present in repo scans or GitHub Actions secrets. Rotate fresh provider keys before any hosted deployment. |
| Observability keys | Rotated, absent, or out of public-release scope | ACCEPTED | 2026-06-11 PT: no observability provider credential is included in this unhosted release; repo scans and GitHub Actions secrets are clear. Rotate fresh credentials before any hosted deployment. |
| GitHub Actions secrets | No stale deployment or provider secrets remain | PASS | 2026-06-11 PT: `gh secret list` returned no repository Actions secrets for source `0xLLM73/gordian-v2` or mirror `0xLLM73/gordian-v2-public`. |

## Runtime Data And Backup Cleanup

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Runtime purge | `pnpm purge:secrets` run where old real runtime credential/session/key residue existed | PASS | 2026-06-11 PT: owner approved local cleanup. `pnpm purge:secrets -- --confirm` cleared local Better Auth/runtime Redis residue, the active local `gordian_dev` schema was reset and rebuilt with `pnpm db:migrate`, and the final `pnpm purge:secrets -- --dry-run` reported 0 matched Telegram/session/OAuth/token/cache/session categories, including 0 `{ai-flow}:*` keys. This command still does not delete imported messages or workspace data; the local DB reset handled that scope. |
| Postgres snapshots | Old snapshots/backups deleted, reset, workspace-deleted, or confirmed out of public-release scope | ACCEPTED | 2026-06-11 PT: active local `gordian_dev` was reset after pre-reset counts showed 5 users, 3 workspaces, 136 contacts, 4,245 messages, and 198 knowledge evidence rows. Post-reset count check confirmed 0 users, 0 workspaces, 0 contacts, 0 messages, 0 knowledge evidence rows, 0 Telegram accounts, and 0 sessions. No production database is included in this unhosted public repository; external snapshots/backups must not be connected to any hosted deployment without separate rotation/review. |
| Redis/Dragonfly residue | Old cache/job/session data purged or confirmed absent | PASS | 2026-06-11 PT: `pnpm purge:secrets -- --confirm` removed local Redis `{ai-flow}:*` residue before and after the temporary worker route smoke. Final dry run reported 0 Redis auth, rate-limit, Telegram session, send, BullMQ, grammY, generic session, and `{ai-flow}:*` keys. |
| Local developer machines | Old `.env.local`, Telegram sessions, and local DB/cache residue cleaned | ACCEPTED | 2026-06-11 PT: active local DB/cache residue was purged/reset and Telegram account/session rows are 0. `.env.local` remains intentionally local and is gitignored; it is not part of the public mirror. |
| Legacy key material | No known raw workspace keys, Telegram session keys, or KMS context secrets remain | ACCEPTED | 2026-06-11 PT: purged-runtime smoke found 0 unsafe Telegram KEK blobs, 0 plaintext-looking Telegram session rows, 0 Telegram OAuth residue rows, and 0 non-Keychain workspace WRK rows after the reset. Public mirror scans, GitHub secret scanning, and open secret alert checks found no repository key material. |

## Telegram Local Safety

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Send disabled | `TELEGRAM_SEND_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Backfill disabled | `TELEGRAM_FULL_BACKFILL_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Periodic sync disabled | `TELEGRAM_PERIODIC_SYNC_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Keychain custody | Real local macOS workspaces use `os-keychain` providers | PASS | Documented in `docs/OPEN_SOURCE.md`, `docs/PUBLIC_STATUS.md`, and `docs/MACOS_TOUCH_ID_MTPROTO.md`; local personal-account testing uses explicit per-import unlock. |
| Telegram smoke | `pnpm telegram:security-smoke` passes against the intended local environment | ACCEPTED | 2026-06-11 PT: `pnpm telegram:security-smoke --allow-missing-credentials --expect-purged` passed with 0 failures and 1 warning after the active local DB/cache reset. The worker send-disabled route returned 503 while `TELEGRAM_SEND_ENABLED=false`. The only warning was skipped Telegram API Keychain credential presence because real Telegram API credentials are intentionally absent for this unhosted public release. |
| Purged-runtime smoke | `pnpm telegram:security-smoke --expect-purged` passes where full runtime data purge was required | PASS | 2026-06-11 PT: after owner-approved local purge plus active `gordian_dev` reset, `pnpm telegram:security-smoke --allow-missing-credentials --expect-purged` passed with 0 failures and 1 warning while the local worker was running. The only warning was skipped Telegram API Keychain credential presence because API credentials are intentionally absent from `.env.local`. |

## Final Sign-Off

| Role | Decision | Date | Notes |
| --- | --- | --- | --- |
| Release owner | APPROVED | 2026-06-11 PT | Zachary Grove approved making the selected mirror public once the sanitized mirror matched source, sensitive-data scans passed, runtime cleanup was complete, and publication settings could be verified. |
| Security reviewer | APPROVED | 2026-06-11 PT | Secret scanning and push protection are enabled, open secret-scanning alerts are empty, open Dependabot alerts are empty, gitleaks/open-source audit passed, AI egress audit passed, Telegram defaults are disabled, and private vulnerability reporting is enabled. |
| Runtime reviewer | APPROVED | 2026-06-11 PT | Active local DB/cache residue was purged/reset, purged-runtime smoke passed, no production deployment is included, GitHub Actions secrets are empty, and external provider credentials/snapshots are accepted as out of scope for this unhosted code release unless a future hosted deployment is created. |

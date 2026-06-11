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
| Validated source baseline | Production app-code baseline remains `c110d801ad769040f788820c4c6bfd5dbf56bae0`; source `main` is current through release evidence, docs, test-only changes, and onboarding hardening PRs #117 through #130 at `8dfc5725`; PR #131 is the current batched release-safety/onboarding update under review |
| Source repository | `0xLLM73/gordian-v2` |
| Release-control accounts | `@0xLLM73` and `@thegrovest` |
| Attestation owner | Zachary Grove using the `@0xLLM73` and `@thegrovest` release-control accounts, assisted by Codex |
| Attestation date | 2026-06-11 PT |
| Publication target | `0xLLM73/gordian-v2-public`; private mirror PR #38 synced source commit `c110d801ad769040f788820c4c6bfd5dbf56bae0`, and mirror PRs #39 through #50 synced later release evidence, docs, test-only changes, and artifact guardrails through mirror `main` `7eaae458` after green CI and required `@thegrovest` review |

This is a readiness attestation, not a final public-release approval. The mirror
remains private. The existing public mirror remains the selected target because
the release docs, check scripts, and GitHub links already point at it. Source
validation is materially stronger after PRs #108 through #116, source PRs #117
through #130 are release evidence, docs, tests, guardrails, onboarding, and local
runtime hardening updates, and mirror PRs #38 through #50 reran the required
gates from the mirror checkout before merge, but this is not a release approval:
the mirror remains private, GitHub public-security settings are not yet
available, provider-side rotation is not signed off, the source changes after
mirror PR #50 still need a final batched mirror sync, and final release
owner/security/runtime sign-offs are still pending. Any later source
changes must be mirrored before publication, but future
attestation changes should be batched with final sign-off, provider/runtime
decisions, publication-setting changes, or other meaningful release-gate
changes instead of creating one PR per evidence checkpoint. If the full-history
mirror scan finds real secrets, private user data, or private operational
context, publish from a fresh sanitized repository instead of keeping the
current mirror history.

## Repository Validation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Clean checkout | `git status --short --branch` shows a clean release branch | PASS | 2026-06-11 PT: source `main` is synced to `origin/main` at `8dfc5725`; PR #131 branch is the current batched release-safety/onboarding update. Mirror `main` is synced at `7eaae458` after mirror PR #50, and must receive one final batched sync after PR #131 merges. |
| Frozen install | `pnpm install --frozen-lockfile` passes | PASS | 2026-06-10 PT: lockfile was up to date and install completed successfully. |
| Dependency audit | `pnpm audit` and `pnpm audit --prod` pass | PASS | 2026-06-11 PT: both commands reported `No known vulnerabilities found` when run with registry access. |
| Open-source audit | `pnpm audit:open-source` passes on a full-depth checkout | PASS | 2026-06-11 PT: `Open-source audit passed` on the PR #131 source branch after the local owner bootstrap, onboarding, and runtime evidence refresh. |
| Lint | `pnpm lint` passes | PASS | 2026-06-11 PT: Biome checked 935 files with no fixes required after the PR #131 updates. |
| Typecheck | `pnpm typecheck` passes | PASS | 2026-06-11 PT: Turbo reported 8 successful typecheck/build tasks; focused `pnpm --filter web typecheck` and `pnpm --filter @repo/db typecheck` also passed. |
| Tests | `pnpm test` passes | PASS | 2026-06-11 PT: Turbo reported 8 successful test tasks; package summaries included 8 crypto files/79 tests, 7 shared files/45 tests, 100 worker files/1,204 tests, and 104 web files/538 tests, with DB tests also green. Worker tests emitted local Redis connection stderr in the sandbox but completed green. Focused PR #131 tests also passed for local-owner bootstrap, invite workspace id persistence, and onboarding connect copy. |
| Demo setup | `pnpm demo:setup` can prepare synthetic local services and seed data | PARTIAL | 2026-06-10 PT: source and mirror `demo:setup` passed `demo:guard` but could not start compose Postgres/Redis because user-owned local services were already bound to `127.0.0.1:5432` and `127.0.0.1:6379`. Equivalent validation continued with `pnpm db:migrate` and `pnpm seed:demo`; mirror browser validation used isolated local database `gordian_release_mirror_c110d80_20260610a`. |
| Demo smoke | `pnpm demo:smoke` passes with synthetic demo data | PASS | 2026-06-11 PT: after local demo reseed and migrations, source Playwright demo smoke passed 7 checks. Mirror PR #38 previously ran the same browser spec directly against the isolated local database and passed 7 checks; GitHub `demo-smoke` also passed on PR #38. |
| Release browser smoke | `pnpm demo:release-smoke` passes with synthetic demo data | PASS | 2026-06-11 PT: after local demo reseed and migrations, source release smoke passed 31/31 desktop/mobile route checks with sensitive-leak guards. The route set included settings, audit, search, knowledge, follow-up plans, follow-up wizard deep link, deal detail, onboarding, and mobile dense routes. |
| Non-demo first-owner onboarding | Fresh local databases can create a non-sample owner and invite additional users without public signup | PASS | 2026-06-11 PT: `pnpm bootstrap:local-owner` created a local owner on the reset database, in-app Browser signed in through `/login`, verified dashboard import consent gating, `/settings`, invite management, closed `/signup`, invite-link signup for a second user, and the `/onboarding/connect` key-custody copy. Browser console capture found no route errors in this flow. The local database was reset again afterward for the clean release baseline. |
| Local runtime safety | `pnpm security:local-runtime-smoke` passes | PASS | 2026-06-11 PT: local runtime safety smoke passed after the approved active `gordian_dev` reset and migration rebuild. |
| Telegram local security smoke | `pnpm telegram:security-smoke --allow-missing-credentials` passes against local DB/Redis | PARTIAL | 2026-06-11 PT: after owner-approved local purge plus active `gordian_dev` reset, `pnpm telegram:security-smoke --allow-missing-credentials --expect-purged` passed with 0 failures and 1 warning while the local worker was running. It verified local-only URLs, Telegram/workspace Keychain split, strict Touch ID request configuration, 0 unsafe Telegram KEK blobs, 0 plaintext-looking Telegram session rows, 0 Telegram OAuth residue, 0 non-Keychain workspace WRK rows, 0 imported message rows, 0 knowledge evidence rows, 0 Redis residue, purge tooling registration, and worker send-disabled route behavior (`send-message` returned 503 while `TELEGRAM_SEND_ENABLED=false`). Remaining warning is skipped Telegram API Keychain credential presence because Telegram API credentials are intentionally absent from `.env.local`; rerun without `--allow-missing-credentials` only if credentialed Telegram API verification is required. |
| Derived data audit | `pnpm security:derived-data-audit` passes | PASS | 2026-06-10 PT: source and mirror isolated-DB audits completed with 0 violations. Mirror checked 17 plain derived columns, 72 plain derived rows, 9 vector columns, and 40 populated vector rows. |
| Knowledge security audit | `pnpm kg:security:audit` passes | PASS | 2026-06-10 PT: source and mirror isolated-DB audits completed with 0 violations. The seeded databases had no plaintext-shaped knowledge leaks in the checked surfaces. |
| Local AI readiness | `pnpm local-ai:doctor` and `pnpm kg:local:smoke` pass | PASS | 2026-06-10 PT: source validated local AI readiness, and mirror PR #38 validated Qwen local AI through temporary nontracked env `/private/tmp/gordian-mirror-local-ai.env`; doctor had 0 failures and 0 warnings, `qwen3-embedding:0.6b` returned 512 dimensions, and `qwen3.5:9b` handled commitment extraction, chat assistant, and digest generation. Temporary Ollama was stopped after validation. |
| Publication check | `pnpm check:publication --repo 0xLLM73/gordian-v2-public` passes after the repo is public | BLOCKED | 2026-06-11 PT: check failed as expected because the selected mirror is private; secret scanning and push protection are unavailable while private; private vulnerability reporting returns 404 while private. Rerun after PR #131 is merged, the mirror is synced, the mirror is intentionally made public, and GitHub-side settings are enabled. |

## GitHub Settings

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Repository visibility | Repository is public only when intentionally ready | PASS | 2026-06-11 PT: source and selected mirror were confirmed private. Keep the mirror private until the sanitized release tree is synced, provider rotation is signed off, runtime cleanup is signed off, and final human sign-off is complete. |
| Secret scanning | Enabled | BLOCKED | 2026-06-11 PT: `pnpm check:publication --repo 0xLLM73/gordian-v2-public` reports secret scanning unavailable while the mirror remains private. Re-run after intentional publication. |
| Push protection | Enabled | BLOCKED | 2026-06-11 PT: `pnpm check:publication --repo 0xLLM73/gordian-v2-public` reports push protection unavailable while the mirror remains private. Re-run after intentional publication. |
| Private vulnerability reporting | Enabled | BLOCKED | 2026-06-11 PT: GitHub API returns 404 while the mirror remains private. Re-run after intentional publication and enable private vulnerability reporting. |
| Dependabot alerts | Enabled | PARTIAL | 2026-06-11 PT: source and mirror Dependabot vulnerability-alert endpoints returned 204, and merged mirror `main` pins `hono 4.12.23` while passing prior `pnpm audit` plus `pnpm audit --prod`. Earlier open alert queries returned `[]`; alert-list API calls can return 404 while private, so re-check alerts after the public flip. |
| Dependabot security updates | Enabled and unpaused | PASS | 2026-06-11 PT: source and mirror automated-security-fixes endpoints returned `{"enabled":true,"paused":false}`. |
| Branch checks | `main` requires strict `validate` and `demo-smoke` checks | PASS | 2026-06-11 PT: source and mirror `main` require strict `validate` and `demo-smoke` checks. Mirror PRs #38 through #50 passed GitHub `validate` and `demo-smoke`; PR #38 also passed `postgres-smoke`. |
| Review policy | `main` requires owner approval before merge | PASS | 2026-06-11 PT: source and mirror branch protection require CODEOWNER review with one approval, dismiss stale reviews, enforce admins, require linear history, block force pushes, and block deletions. Mirror PRs #38 through #50 stayed blocked until required `@thegrovest` review landed, then merged cleanly. |
| Protected history | `main` blocks force pushes and deletion, enforces admins and linear history | PASS | Source and mirror branch protection confirms admins enforced, linear history required, force pushes blocked, deletions blocked, and conversation resolution required. |

## Ongoing Regression System

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Every PR gate | CI runs open-source audit, package audits, lint, typecheck, tests, and demo smoke before merge | PASS | PRs #108 through #130 merged only after required review and green CI; mirror PRs #38 through #50 merged after required review and green CI. PR #131 is the current batched release-safety/onboarding update awaiting final approval and CI after this refresh. |
| Release browser QA matrix | Full route matrix is run for each release candidate and evidence is recorded here | PASS | 2026-06-11 PT: source release smoke passed 31/31 desktop/mobile route checks. In-app Browser also validated the non-demo first-owner and invite signup path against `http://localhost:3000` with no captured console errors. Repeat after any later mirror sync if source changes again before publication. |
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
| GitHub Actions secrets | No stale deployment or provider secrets remain | PASS | 2026-06-11 PT: `gh secret list` returned no repository Actions secrets for source `0xLLM73/gordian-v2` or mirror `0xLLM73/gordian-v2-public`. |

## Runtime Data And Backup Cleanup

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Runtime purge | `pnpm purge:secrets` run where old real runtime credential/session/key residue existed | PASS | 2026-06-11 PT: owner approved local cleanup. `pnpm purge:secrets -- --confirm` cleared local Better Auth/runtime Redis residue, the active local `gordian_dev` schema was reset and rebuilt with `pnpm db:migrate`, and the final `pnpm purge:secrets -- --dry-run` reported 0 matched Telegram/session/OAuth/token/cache/session categories, including 0 `{ai-flow}:*` keys. This command still does not delete imported messages or workspace data; the local DB reset handled that scope. |
| Postgres snapshots | Old snapshots/backups deleted, reset, workspace-deleted, or confirmed out of public-release scope | PARTIAL | 2026-06-11 PT: active local `gordian_dev` was reset after pre-reset counts showed 5 users, 3 workspaces, 136 contacts, 4,245 messages, and 198 knowledge evidence rows. Post-reset count check confirmed 0 users, 0 workspaces, 0 contacts, 0 messages, 0 knowledge evidence rows, 0 Telegram accounts, and 0 sessions. External provider snapshots/backups still require human sign-off. |
| Redis/Dragonfly residue | Old cache/job/session data purged or confirmed absent | PASS | 2026-06-11 PT: `pnpm purge:secrets -- --confirm` removed local Redis `{ai-flow}:*` residue before and after the temporary worker route smoke. Final dry run reported 0 Redis auth, rate-limit, Telegram session, send, BullMQ, grammY, generic session, and `{ai-flow}:*` keys. |
| Local developer machines | Old `.env.local`, Telegram sessions, and local DB/cache residue cleaned | PARTIAL | 2026-06-11 PT: active local DB/cache residue was purged/reset and Telegram account/session rows are 0. `.env.local` remains intentionally for local development with local-only generated secrets; broader local file/backups cleanup still needs human sign-off before public announcement. |
| Legacy key material | No known raw workspace keys, Telegram session keys, or KMS context secrets remain | PARTIAL | 2026-06-11 PT: purged-runtime smoke found 0 unsafe Telegram KEK blobs, 0 plaintext-looking Telegram session rows, 0 Telegram OAuth residue rows, and 0 non-Keychain workspace WRK rows after the reset. External provider dashboards, local backups, and old snapshots still require human sign-off. |

## Telegram Local Safety

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Send disabled | `TELEGRAM_SEND_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Backfill disabled | `TELEGRAM_FULL_BACKFILL_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Periodic sync disabled | `TELEGRAM_PERIODIC_SYNC_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Keychain custody | Real local macOS workspaces use `os-keychain` providers | PASS | Documented in `docs/OPEN_SOURCE.md`, `docs/PUBLIC_STATUS.md`, and `docs/MACOS_TOUCH_ID_MTPROTO.md`; local personal-account testing uses explicit per-import unlock. |
| Telegram smoke | `pnpm telegram:security-smoke` passes against the intended local environment | PARTIAL | 2026-06-11 PT: `pnpm telegram:security-smoke --allow-missing-credentials --expect-purged` passed with 0 failures and 1 warning after the active local DB/cache reset. The worker send-disabled route returned 503 while `TELEGRAM_SEND_ENABLED=false`. Credentialed Telegram API presence remains pending or must be explicitly accepted as a skipped local-credential check before any real-account release test. |
| Purged-runtime smoke | `pnpm telegram:security-smoke --expect-purged` passes where full runtime data purge was required | PASS | 2026-06-11 PT: after owner-approved local purge plus active `gordian_dev` reset, `pnpm telegram:security-smoke --allow-missing-credentials --expect-purged` passed with 0 failures and 1 warning while the local worker was running. The only warning was skipped Telegram API Keychain credential presence because API credentials are intentionally absent from `.env.local`. |

## Final Sign-Off

| Role | Decision | Date | Notes |
| --- | --- | --- | --- |
| Release owner | TODO | TODO | Zachary Grove using `@0xLLM73` after final release gates pass. |
| Security reviewer | TODO | TODO | Zachary Grove using the separate `@thegrovest` release-control account after reviewing secret scanning, provider rotation, AI egress, Telegram safety, and browser QA evidence. |
| Runtime reviewer | TODO | TODO | Zachary Grove must confirm provider dashboards, local machines, databases, Redis/Dragonfly, backups, and old Telegram sessions are purged or intentionally out of scope. |

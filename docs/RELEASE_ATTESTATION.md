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
| Release candidate commit | `fe97ac196451` |
| Source repository | `0xLLM73/gordian-v2` |
| Attestation owner | `0xLLM73` release owner, assisted by Codex |
| Attestation date | 2026-06-08 PT |
| Publication target | `0xLLM73/gordian-v2-public` private mirror `main` at `be88d03dbcc1` |

This is a readiness attestation, not a final public-release approval. The mirror
remains private. Follow-up notification-product tweaks and provider-side human
sign-off are still pending before any public announcement.

## Repository Validation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Clean checkout | `git status --short --branch` shows a clean release branch | PASS | Source release tree was clean at `fe97ac196451`; mirror `main` was clean at `be88d03dbcc1` after PR #36 merged. |
| Frozen install | `pnpm install --frozen-lockfile` passes | PASS | Passed from the private mirror checkout on 2026-06-08 PT. |
| Dependency audit | `pnpm audit` and `pnpm audit --prod` pass | PASS | Both passed from merged private mirror `main` at `be88d03dbcc1` on 2026-06-08 PT. |
| Open-source audit | `pnpm audit:open-source` passes on a full-depth checkout | PASS | Passed from a full-depth private mirror `main` checkout at `be88d03dbcc1` on 2026-06-08 PT. |
| Lint | `pnpm lint` passes | PASS | Passed from the private mirror checkout on 2026-06-08 PT. |
| Typecheck | `pnpm typecheck` passes | PASS | Passed from the private mirror checkout on 2026-06-08 PT. |
| Tests | `pnpm test` passes | PASS | Passed from the private mirror checkout on 2026-06-08 PT. |
| Demo smoke | `pnpm demo:smoke` passes with synthetic demo data | PASS | Passed 7 Playwright demo-route checks from the private mirror checkout on 2026-06-08 PT. |
| Local runtime safety | `pnpm security:local-runtime-smoke` passes | PASS | Passed from the private mirror checkout on 2026-06-08 PT. |
| Publication check | `pnpm check:publication` passes after the repo is public | PENDING | Ran against the private mirror and failed only on expected private-repo/publication-only settings: visibility, secret scanning, push protection, and private vulnerability reporting. |

## GitHub Settings

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Repository visibility | Repository is public only when intentionally ready | PASS | Source and mirror were confirmed private on 2026-06-08 PT. |
| Secret scanning | Enabled | PENDING | GitHub API reports this as unavailable while the mirror remains private; re-run `pnpm check:publication` after intentional publication. |
| Push protection | Enabled | PENDING | GitHub API reports this as unavailable while the mirror remains private; re-run `pnpm check:publication` after intentional publication. |
| Private vulnerability reporting | Enabled | PENDING | GitHub API returns 404 while the mirror remains private; re-run `pnpm check:publication` after intentional publication. |
| Dependabot alerts | Enabled | NEEDS REVIEW | The stale mirror default-branch Hono advisories were resolved by merging PR #36. Merged mirror `main` pins `hono 4.12.23` and passes `pnpm audit` plus `pnpm audit --prod`; the Dependabot alerts API still returns 404 while the mirror remains private, so recheck in GitHub before publication. |
| Dependabot security updates | Enabled and unpaused | NEEDS REVIEW | Confirm in GitHub settings before publication. |
| Branch checks | `main` requires strict `validate` and `demo-smoke` checks | PASS | Source and mirror `main` require strict `validate` and `demo-smoke` checks. |
| Review policy | `main` requires at least one approval | PASS | Source and mirror `main` now require one approving review. CODEOWNER review is not enabled because no public CODEOWNERS policy is finalized. |
| Protected history | `main` blocks force pushes and deletion, enforces admins and linear history | PASS | Source and mirror branch protection confirms admins enforced, linear history required, force pushes blocked, deletions blocked, and conversation resolution required. |

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
| Local developer machines | Old `.env.local`, Telegram sessions, and local DB/cache residue cleaned | TODO | TODO |
| Legacy key material | No known raw workspace keys, Telegram session keys, or KMS context secrets remain | TODO | TODO |

## Telegram Local Safety

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Send disabled | `TELEGRAM_SEND_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Backfill disabled | `TELEGRAM_FULL_BACKFILL_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Periodic sync disabled | `TELEGRAM_PERIODIC_SYNC_ENABLED=false` in release/demo defaults | PASS | Safe default is enforced by `.env.example` and `pnpm audit:open-source`. |
| Keychain custody | Real local macOS workspaces use `os-keychain` providers | PASS | Documented in `docs/OPEN_SOURCE.md`, `docs/PUBLIC_STATUS.md`, and `docs/MACOS_TOUCH_ID_MTPROTO.md`; local personal-account testing uses explicit per-import unlock. |
| Telegram smoke | `pnpm telegram:security-smoke` passes against the intended local environment | PENDING | Requires the intended local Telegram environment and user approval; do before any real-account release test. |
| Purged-runtime smoke | `pnpm telegram:security-smoke --expect-purged` passes where runtime purge was required | PENDING | Requires provider/runtime cleanup first; do before any public announcement. |

## Final Sign-Off

| Role | Decision | Date | Notes |
| --- | --- | --- | --- |
| Release owner | TODO | TODO | TODO |
| Security reviewer | TODO | TODO | TODO |
| Runtime reviewer | TODO | TODO | TODO |

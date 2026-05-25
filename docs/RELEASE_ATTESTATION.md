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
| Release candidate commit | TODO |
| Attestation owner | TODO |
| Attestation date | TODO |
| Publication target | TODO |

## Repository Validation

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Clean checkout | `git status --short --branch` shows a clean release branch | TODO | TODO |
| Frozen install | `pnpm install --frozen-lockfile` passes | TODO | TODO |
| Dependency audit | `pnpm audit` and `pnpm audit --prod` pass | TODO | TODO |
| Open-source audit | `pnpm audit:open-source` passes on a full-depth checkout | TODO | TODO |
| Lint | `pnpm lint` passes | TODO | TODO |
| Typecheck | `pnpm typecheck` passes | TODO | TODO |
| Tests | `pnpm test` passes | TODO | TODO |
| Demo smoke | `pnpm demo:smoke` passes with synthetic demo data | TODO | TODO |
| Local runtime safety | `pnpm security:local-runtime-smoke` passes | TODO | TODO |
| Publication check | `pnpm check:publication` passes after the repo is public | TODO | TODO |

## GitHub Settings

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| Repository visibility | Repository is public only when intentionally ready | TODO | TODO |
| Secret scanning | Enabled | TODO | TODO |
| Push protection | Enabled | TODO | TODO |
| Private vulnerability reporting | Enabled | TODO | TODO |
| Dependabot alerts | Enabled | TODO | TODO |
| Dependabot security updates | Enabled and unpaused | TODO | TODO |
| Branch checks | `main` requires strict `validate` and `demo-smoke` checks | TODO | TODO |
| Review policy | `main` requires at least one approval and CODEOWNER review | TODO | TODO |
| Protected history | `main` blocks force pushes and deletion, enforces admins and linear history | TODO | TODO |

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
| Send disabled | `TELEGRAM_SEND_ENABLED=false` in release/demo defaults | TODO | TODO |
| Backfill disabled | `TELEGRAM_FULL_BACKFILL_ENABLED=false` in release/demo defaults | TODO | TODO |
| Periodic sync disabled | `TELEGRAM_PERIODIC_SYNC_ENABLED=false` in release/demo defaults | TODO | TODO |
| Keychain custody | Real local macOS workspaces use `os-keychain` providers | TODO | TODO |
| Telegram smoke | `pnpm telegram:security-smoke` passes against the intended local environment | TODO | TODO |
| Purged-runtime smoke | `pnpm telegram:security-smoke --expect-purged` passes where runtime purge was required | TODO | TODO |

## Final Sign-Off

| Role | Decision | Date | Notes |
| --- | --- | --- | --- |
| Release owner | TODO | TODO | TODO |
| Security reviewer | TODO | TODO | TODO |
| Runtime reviewer | TODO | TODO | TODO |

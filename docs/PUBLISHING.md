# Publishing Checklist

Use this checklist only after the local release checks pass. It covers the parts
that cannot be proven by the repository alone.

## Publication Target

The selected publication target is the synced
`0xLLM73/gordian-v2-public` mirror.

As of the 2026-06-08 readiness audit:

- `0xLLM73/gordian-v2` is the private source of truth and includes the current
  MTProto Touch ID hardening baseline.
- `0xLLM73/gordian-v2` `main` now requires one approving review, strict
  `validate` and `demo-smoke` checks, linear history, admin enforcement,
  conversation resolution, and blocks force pushes/deletions.
- `0xLLM73/gordian-v2-public` exists, is also private, and PR #36 merged a
  sanitized mirror snapshot from source commit `fe97ac196451` into mirror
  `main` at `be88d03dbcc1`.
- Mirror PR #36 passed GitHub `validate`, `demo-smoke`, and `postgres-smoke`
  before merge.
- A GitHub push warning previously reported 4 moderate Dependabot alerts on the
  mirror default branch. Direct audits identified them as Hono advisories
  against stale mirror `main` lockfile version `hono 4.12.18`; merged mirror
  `main` now pins `hono 4.12.23` and passes `pnpm audit` plus `pnpm audit
  --prod`. The Dependabot alerts API still returns 404 while the mirror remains
  private, so recheck GitHub before publication.

Before launch, sync the mirror as a sanitized release tree, verify absolute
GitHub links point at `gordian-v2-public`, and run every local and GitHub
publication gate against the mirror checkout and origin. Do not force-push the
private source repository history into the public mirror unless that history has
been separately approved for public release.

Notification-product tweaks are intentionally not part of the publication gate
itself, but they remain queued release work before any announcement because they
affect the first-run user experience.

## Local Release Gate

Run these from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm audit:open-source
pnpm audit
pnpm audit --prod
pnpm lint
pnpm typecheck
pnpm test
pnpm demo:setup
pnpm demo:smoke
pnpm security:local-runtime-smoke
```

If the public demo is intended to run without hosted AI provider accounts, use
the documented Nomic path, or Qwen when you only need to prove local KG vectors:

```bash
pnpm local-ai:setup:nomic
# or
pnpm local-ai:setup:qwen
pnpm kg:local:smoke
```

`pnpm audit:open-source` scans the tracked and unignored public tree, verifies
required governance files and Dependabot npm/GitHub Actions/Docker/Docker Compose coverage,
confirms `docs/archive/` is tombstone-only, checks safe Telegram defaults, and
requires `gitleaks` against the public tree and full git history. CI installs a
pinned Gitleaks release on a full-depth checkout before running this gate; a
missing scanner or shallow checkout is a failure.
`pnpm audit` covers both runtime and development/tooling dependencies, including
packages that contributors install locally. `pnpm audit --prod` is kept as a
separate production-runtime signal.

## GitHub Publication Gate

After the repo is public, run:

```bash
pnpm check:publication
```

This read-only check uses `gh api` against the origin repository and fails until:

- repository visibility is public;
- Dependabot version-update coverage includes npm, GitHub Actions, the web and
  worker Dockerfiles, and `docker-compose.yml`;
- Dependabot vulnerability alerts are enabled;
- Dependabot security updates are enabled and unpaused;
- secret scanning is enabled;
- secret scanning push protection is enabled;
- private vulnerability reporting is enabled;
- `main` requires the `validate` and `demo-smoke` checks;
- `main` blocks force pushes and deletion;
- `main` enforces admins, linear history, and conversation resolution.

If the repo is private or the account plan does not expose secret scanning,
push protection, or private vulnerability reporting, this command should fail.
That failure is expected until the GitHub-side settings are available.

## Provider-Side Rotation Gate

The repository cannot revoke credentials stored outside git. Before announcing
the project publicly, verify each item in the provider dashboards:

- old Telegram bot token is deleted or rotated in BotFather;
- old Telegram API app credentials are no longer used;
- all real Telegram user sessions connected to this project are revoked;
- old deployment providers no longer hold `BOT_TOKEN`, `TELEGRAM_API_ID`, or
  `TELEGRAM_API_HASH`;
- database URLs and passwords are rotated;
- Supabase anon and service keys are rotated;
- AWS access keys and KMS-related credentials are rotated;
- AI provider and observability keys are rotated;
- local/proxy AI endpoint bearer tokens are rotated if they were ever used;
- GitHub Actions has no deployment secrets except intentional throwaway demo
  infrastructure;
- old databases, Redis/Dragonfly snapshots, and backups are deleted or purged
  with `pnpm purge:secrets`.

Record the final human sign-off in [RELEASE_ATTESTATION.md](RELEASE_ATTESTATION.md).
Do not paste secret values, raw session strings, database URLs, or customer data
into that record; use dates, owners, and short evidence notes only.

## Release Note

The first public release should say clearly that this is an experimental,
unhosted codebase. Builders should start with synthetic demo data and should not
connect real Telegram accounts until they complete their own security review.

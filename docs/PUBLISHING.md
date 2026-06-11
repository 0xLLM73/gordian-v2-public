# Publishing Checklist

Use this checklist only after the local release checks pass. It covers the parts
that cannot be proven by the repository alone.

## Publication Target

The selected publication target is the synced
`0xLLM73/gordian-v2-public` mirror.

As of the 2026-06-11 public mirror flip:

- `0xLLM73/gordian-v2` is the private source of truth. The production app-code
  release candidate remains
  `c110d801ad769040f788820c4c6bfd5dbf56bae0` after PRs #108 through #116
  merged; the public-flip source baseline included later release evidence,
  docs, tests, guardrails, onboarding, and local runtime hardening PRs #117
  through #131 at `102646b4`.
- Source and mirror `main` branch protections require pull requests, owner
  review, strict `validate` and `demo-smoke` checks, linear history, admin
  enforcement, conversation resolution, stale-review dismissal, and blocked
  force pushes/deletions.
- `.github/CODEOWNERS` assigns every path to the release-control accounts
  `@0xLLM73` and `@thegrovest`, so public contributors cannot merge changes
  without owner review.
- `0xLLM73/gordian-v2-public` remains the selected publication target. It is
  public. PR #36 and PR #37 are historical mirror-evidence PRs. Mirror
  PR #38 synced source commit
  `c110d801ad769040f788820c4c6bfd5dbf56bae0` into the mirror and merged at
  `44e3dd0a4df5de5e6a2a030a5952810f6ccc6555` after GitHub `validate`,
  `demo-smoke`, and `postgres-smoke` passed and required `@thegrovest` review
  landed. Mirror PRs #39 through #48 then synced later release evidence, docs,
  and test-only source changes, and mirror PR #50 batched source PR #128 docs
  plus source PR #129 artifact guardrails through mirror `main` `7eaae458`.
  Mirror PR #51 then synced source PR #130 and source PR #131 through mirror
  `main` `0d217f4`.
- The mirror is synced from the final selected source release commit for this
  unhosted code release. If a future full-history mirror scan finds real
  secrets, private user data, or private operational context, abandon that
  mirror history and publish from a fresh sanitized repository instead.
- Avoid one evidence-only PR per checkpoint. Batch future attestation changes
  with final sign-off, provider/runtime decisions, publication-setting changes,
  or other meaningful release-gate changes.
- A GitHub push warning previously reported 4 moderate Dependabot alerts on the
  mirror default branch. Direct audits identified them as Hono advisories
  against stale mirror `main` lockfile version `hono 4.12.18`; merged mirror
  `main` now pins `hono 4.12.23` and passes `pnpm audit` plus `pnpm audit
  --prod`. On 2026-06-11 PT after the public flip, the mirror vulnerability-alert
  endpoint returned 204, automated security fixes were enabled and unpaused, and
  the open Dependabot alert query returned `[]`.
- The 2026-06-11 source and mirror validation passes for the public-flip
  baseline through source PR #131 and mirror PR #51 completed or refreshed the
  repository gates listed in
  [RELEASE_ATTESTATION.md](RELEASE_ATTESTATION.md), including
  `pnpm audit:open-source`, `pnpm audit`, `pnpm audit --prod`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm demo:smoke`,
  `pnpm demo:release-smoke`, `pnpm security:local-runtime-smoke`,
  `pnpm security:derived-data-audit`, `pnpm kg:security:audit`,
  `pnpm local-ai:doctor`, and `pnpm kg:local:smoke`. Mirror browser smoke used
  isolated local database `gordian_release_mirror_c110d80_20260610a` because the
  default shared local database correctly blocks demo login when it contains
  Telegram data. `pnpm demo:setup` was partially blocked by already-running
  local Postgres and Redis services on the standard ports, so the migrate and
  seed steps were run successfully against local services instead.
- `pnpm check:publication --repo 0xLLM73/gordian-v2-public` passes after the
  public flip. Repository visibility is public, secret scanning and push
  protection are enabled, private vulnerability reporting is enabled, Dependabot
  alerts/security updates are enabled, and branch protection remains enforced.

Before announcement, verify the latest mirror sync still includes any new source
changes, verify absolute GitHub links point at `gordian-v2-public`, and rerun
the local and GitHub publication gates against the mirror checkout and origin.
Do not force-push the private source repository history into the public mirror
unless that history has been separately approved for public release.

Notification-product tweaks are intentionally not part of the publication gate
itself, but they remain queued release work before any announcement because they
affect the first-run user experience.

The ongoing release regression system is documented in
[docs/RELEASE_REGRESSION_SYSTEM.md](./RELEASE_REGRESSION_SYSTEM.md). Use it for
the every-PR, release-candidate, weekly, and monthly follow-up cadence after the
first public release.

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

For a non-demo first-user path on a fresh local database, run
`pnpm bootstrap:local-owner -- --email you@example.local --name "Your Name"` after
`pnpm db:migrate`, then sign in with that local owner and create additional users
through workspace invites. This command must remain local-only; it is not a
replacement for invite-only application signup.

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

After the selected mirror is public, run this from the mirror checkout:

```bash
pnpm check:publication
```

From the private source checkout, pass the mirror target explicitly:

```bash
GORDIAN_PUBLICATION_REPO=0xLLM73/gordian-v2-public pnpm check:publication
# or
pnpm check:publication --repo 0xLLM73/gordian-v2-public
```

This read-only check uses `gh api` against the selected repository and fails until:

- repository visibility is public;
- Dependabot version-update coverage includes npm, GitHub Actions, the web and
  worker Dockerfiles, and `docker-compose.yml`;
- Dependabot vulnerability alerts are enabled;
- Dependabot security updates are enabled and unpaused;
- secret scanning is enabled;
- secret scanning push protection is enabled;
- private vulnerability reporting is enabled;
- `main` requires the `validate` and `demo-smoke` checks;
- `main` requires at least one approving pull request review;
- `main` requires CODEOWNER review for every changed path;
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
- old databases, Redis/Dragonfly snapshots, and backups are deleted/reset or
  explicitly accepted as local-only and out of public-release scope;
- `pnpm purge:secrets` is run where credential/session/runtime-key residue
  exists, with the understanding that it clears secrets and volatile runtime
  keys but does not delete imported messages or other workspace data.

Record the final human sign-off in [RELEASE_ATTESTATION.md](RELEASE_ATTESTATION.md).
Do not paste secret values, raw session strings, database URLs, or customer data
into that record; use dates, owners, and short evidence notes only.

## Post-Launch Regression Practice

After launch, keep the release regression system current with every release
candidate. Any change that adds a data field, export, logger, audit event,
provider integration, AI prompt or embedding flow, Telegram send/import path,
runtime cache, purge path, or browser-visible sensitive data requires the
expanded checks in [docs/RELEASE_REGRESSION_SYSTEM.md](./RELEASE_REGRESSION_SYSTEM.md).

## Release Note

The first public release should say clearly that this is an experimental,
unhosted codebase. Builders should start with synthetic demo data and should not
connect real Telegram accounts until they complete their own security review.

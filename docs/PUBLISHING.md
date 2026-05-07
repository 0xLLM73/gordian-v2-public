# Publishing Checklist

Use this checklist only after the local release checks pass. It covers the parts
that cannot be proven by the repository alone.

## Current Public Repo Status

This public snapshot was published from a clean-history repository. The GitHub
publication gate has been completed for the public repo: repository visibility,
Dependabot alerts/security updates, secret scanning, push protection, private
vulnerability reporting, and `main` branch protection are enabled.

Use the checklist below for future releases, forks, or deployment-specific
publication work.

## Local Release Gate

Run these from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm audit:open-source
pnpm audit --prod
pnpm lint
pnpm typecheck
pnpm test
pnpm demo:setup
pnpm demo:smoke
```

`pnpm audit:open-source` scans the tracked and unignored public tree, verifies
required governance files, confirms `docs/archive/` is tombstone-only, checks
safe Telegram defaults, and runs `gitleaks` against the public tree and full git
history.

## GitHub Publication Gate

After the repo is public, run:

```bash
pnpm check:publication
```

This read-only check uses `gh api` against the origin repository and fails until:

- repository visibility is public;
- Dependabot vulnerability alerts are enabled;
- Dependabot security updates are enabled and unpaused;
- secret scanning is enabled;
- secret scanning push protection is enabled;
- private vulnerability reporting is enabled;
- `main` requires the `validate` and `demo-smoke` checks;
- `main` blocks force pushes and deletion;
- `main` enforces admins, linear history, and conversation resolution.

If the repo is private, branch protection is incomplete, or the account plan does
not expose secret scanning, push protection, or private vulnerability reporting,
this command should fail. That failure is expected until the GitHub-side settings
are available.

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
- GitHub Actions has no deployment secrets except intentional throwaway demo
  infrastructure;
- old databases, Redis/Dragonfly snapshots, and backups are deleted or purged
  with `pnpm purge:secrets`.

## Release Note

The first public release should say clearly that this is an experimental,
unhosted codebase. Builders should start with synthetic demo data and should not
connect real Telegram accounts until they complete their own security review.

# Release Regression System

This is the ongoing safety system for the open-source release. It defines the
checks that must run after launch so future changes do not quietly reintroduce
secret, private-data, AI-egress, Telegram, export, logging, or browser-visible
regressions.

## Every PR

Every PR must keep the normal CI gate green:

```bash
pnpm audit:open-source
pnpm audit
pnpm audit --prod
pnpm lint
pnpm typecheck
pnpm test
pnpm demo:smoke
```

The PR description must name whether the change touches any regression trigger.
If it does, the author must list the focused extra tests and browser routes used
to prove the changed surface stayed safe.

## Every Release Candidate

Before selecting a public release commit, run the full local release gate from
[PUBLISHING.md](./PUBLISHING.md), then run the release browser QA matrix against
the selected source tree and again after syncing the publication mirror.

The release browser QA matrix must cover the sensitive end-user routes:

- `/`
- `/contacts`
- `/contacts/[seeded-contact-id]`
- `/deals`
- `/deals/[seeded-deal-id]`
- `/commitments`
- `/goals`
- `/follow-up-plans`
- `/follow-up-plans?new=1&contactId=[seeded-contact-id]&goalId=[seeded-goal-id]`
- `/knowledge`
- `/search`
- `/digest`
- `/introductions`
- `/network`
- `/settings`
- `/settings/audit`
- `/settings/learning`
- `/tokens`
- `/onboarding`
- `/onboarding/connect`
- `/onboarding/sync`
- `/onboarding/verify`
- `/onboarding/calibrate`
- `/onboarding/first-look`
- `/onboarding/what-matters`

For each route, verify the visible product surface loads, browser console output
is free of uncaught errors, and no secret-like value, provider credential,
database URL, Redis URL, Telegram token/session material, raw provider config,
or unexpected user-sensitive payload appears.

Record release-candidate evidence in [RELEASE_ATTESTATION.md](./RELEASE_ATTESTATION.md).
Do not mark a release ready while any P0 gate is `TODO`, `PENDING`, or
unverified.

## Weekly

Run a lightweight external-control review:

```bash
pnpm check:publication --repo 0xLLM73/gordian-v2-public
```

Review Dependabot alerts, Dependabot security update status, GitHub secret
scanning, push protection, private vulnerability reporting, branch protection,
and required check names. If the mirror is still private or GitHub-side settings
are unavailable, record that as a pending release blocker instead of treating it
as a pass.

## Monthly

Review the sensitive-data surfaces that can drift without obvious product
changes:

- data classification and schema changes;
- export allowlists and generated files;
- AI egress, prompts, embeddings, and provider inventory;
- logging, audit events, and error serialization;
- Telegram import, session, and sending safety;
- runtime purge coverage for Postgres, Redis or Dragonfly, queues, local caches,
  generated local secrets, and Telegram residue.

Use the focused audit commands that match the touched area, including:

```bash
pnpm security:derived-data-audit
pnpm kg:security:audit
pnpm telegram:security-smoke --allow-missing-credentials --skip-db --skip-redis --skip-worker
pnpm security:local-runtime-smoke
```

## Regression Triggers

Any PR with one of these triggers requires expanded verification beyond the
normal CI gate:

- New data model field.
- New export path or generated file.
- New logger, audit event, telemetry event, or error serialization path.
- New external provider integration.
- New AI prompt, embedding flow, model call, retrieval context, or derived-data
  cache.
- New Telegram send/import/session behavior.
- New onboarding, settings, search, knowledge, follow-up, contact, deal, or
  public route.
- New browser-visible sensitive data.
- New runtime cache, queue, local secret, local AI artifact, or purge path.

For browser-visible triggers, test the changed route plus `/settings`,
`/settings/audit`, and `/search`. For AI, export, logging, or Telegram triggers,
also inspect browser console output and confirm no sensitive fixture value leaks
into visible UI, logs, downloads, or test artifacts.

## Accepted Risks

Accepted risks must be named, dated, and owned in
[RELEASE_ATTESTATION.md](./RELEASE_ATTESTATION.md). A skipped command, private
mirror limitation, missing local model, unavailable Telegram credential, or
provider dashboard item is not a pass unless the release owner explicitly records
the exception and its impact.

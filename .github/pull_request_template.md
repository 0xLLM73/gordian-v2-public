## Summary

<!-- What changed and why? -->

## Public-Release Checklist

- [ ] No real secrets, tokens, session strings, `.env` files, logs, screenshots/videos, database dumps, CSV/JSONL exports, non-demo fixtures, or old provider URLs were added.
- [ ] New or changed logs, errors, console output, and audit events are redacted and do not include raw user text, provider credentials, session material, API keys, Telegram identifiers, DB URLs, Redis URLs, prompts, or embeddings.
- [ ] New data fields, exports, AI provider calls, Telegram send/import behavior, and browser-visible sensitive data are documented or covered by tests where applicable.
- [ ] Browser QA was run for any user-visible privacy, settings, Telegram, AI, export, audit, or error-state change.
- [ ] Telegram remains disabled by default unless this PR is explicitly about a throwaway/demo setup.
- [ ] No private project archives, runbooks, incident notes, or launch plans were added.
- [ ] Public-facing docs still say the original Telegram bot was deleted and old infra is not live.
- [ ] `pnpm audit:open-source` passes.
- [ ] `pnpm audit` passes.
- [ ] `pnpm audit --prod` passes.

## Regression Triggers

Check any trigger this PR touches and list the extra verification in Validation.

- [ ] New data model field.
- [ ] New export path or generated file.
- [ ] New fixture, dump, screenshot/video, log, generated report, or dataset artifact.
- [ ] New logger, audit event, telemetry event, or error serialization path.
- [ ] New external provider integration.
- [ ] New AI prompt, embedding flow, model call, retrieval context, or derived-data cache.
- [ ] New Telegram send/import/session behavior.
- [ ] New browser-visible sensitive data.
- [ ] New onboarding, settings, search, knowledge, follow-up, contact, deal, or public route.
- [ ] New runtime cache, queue, local secret, local AI artifact, or purge path.

## Sensitive-Data Impact

- [ ] No new data model field was added, or `docs/DATA_CLASSIFICATION.md` was updated with storage, export, logging, and purge behavior.
- [ ] No new export path was added, or the exported fields are allowlisted and covered by tests.
- [ ] No new logging, audit event, or error serialization was added, or redaction/allowlist tests cover it.
- [ ] No new AI provider egress, prompt, embedding, or observability path was added, or it is documented, disabled by default, and tested.
- [ ] No new browser-visible sensitive data surface was added, or in-app/browser QA checked for tokens, session strings, provider config, and raw private data.
- [ ] No Telegram sending, import, sync, or session-custody behavior changed, or the change fails closed and includes Telegram safety tests.
- [ ] Browser QA is not required for this PR, or the tested routes and console results are listed below.

## Validation

<!-- List commands run, or explain why validation was skipped. -->

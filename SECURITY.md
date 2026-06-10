# Security Policy

## Supported Status

Gordian v2 is an experimental open-source codebase. Treat it as a reference implementation unless you have completed your own deployment, privacy, and security review.

The original Telegram bot has been deleted and the old hosted infrastructure is not live. Any public fork should create new throwaway Telegram resources if it needs to test Telegram behavior.

## Reporting a Vulnerability

Please do not disclose sensitive vulnerabilities in public issues.

Use GitHub private vulnerability reporting if it is enabled for this repository. If it is not enabled, contact the repository maintainer privately and include:

- affected commit or release;
- impacted component;
- reproduction steps;
- whether credentials, Telegram sessions, or user data may be exposed;
- any logs or proof of concept that do not include real secrets.

Use synthetic identifiers in reports whenever possible. Do not attach `.env`
files, database dumps, Telegram export archives, raw session strings, provider
logs with credentials, screenshots containing secrets, or real user messages.
If proof requires sensitive material, ask the maintainer for a private handling
path first.

## High-Risk Areas

- Telegram MTProto sessions and outbound sending.
- Database access to encrypted user data and key envelopes.
- KMS credentials and workspace root key handling.
- Internal service secrets used between web and worker.
- Supabase service role keys.
- AI provider egress, prompt observability, embeddings, and derived knowledge
  graph data.
- Public/demo exports, audit logs, browser-visible errors, and release
  artifacts.

## Telegram Guidance

Do not connect a real Telegram account to an unreviewed fork. Use a throwaway Telegram account, a new dedicated test bot, and a new dedicated Telegram API app.

Before publishing or deploying, read [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md) and rotate/revoke all real Telegram credentials and sessions.

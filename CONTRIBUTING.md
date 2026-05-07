# Contributing

Thanks for improving Gordian v2.

## Development

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm audit:open-source
pnpm audit --prod
pnpm lint
pnpm typecheck
pnpm test
```

Use `pnpm demo:setup` and `pnpm demo:smoke` when touching onboarding, auth, seeded demo data, or dashboard flows.

Keep Telegram disabled unless your change specifically needs it. If you do enable it, use only throwaway Telegram credentials and accounts. Never connect a real Telegram account to a public fork or shared development environment.

## Pull Requests

- Keep changes scoped.
- Add or update tests for behavior changes.
- Do not commit `.env`, logs, screenshots with secrets, database dumps, or real Telegram data.
- Do not include real user messages, contacts, phone numbers, or session strings in fixtures.
- Do not add private project archives, runbooks, incident notes, launch notes, or old infrastructure plans.
- Run `pnpm audit:open-source`, `pnpm audit --prod`, `pnpm lint`, `pnpm typecheck`, and relevant tests before requesting review.

## Security Work

For security-sensitive changes, include the threat model and the failure mode the change prevents. Report suspected vulnerabilities privately through the process in [SECURITY.md](SECURITY.md).

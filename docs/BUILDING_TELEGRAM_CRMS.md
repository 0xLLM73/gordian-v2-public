# Building Telegram CRMs From This Repo

This repo is a starting point for customer relationship products that need
Telegram-aware workflows. It is not a hosted SaaS template and it is not safe to
connect real Telegram accounts until you complete your own security review.

Use this guide after reading `docs/OPEN_SOURCE.md` and `ARCHITECTURE.md`.

## Recommended Starting Path

1. Run the synthetic local demo first.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm demo:setup
pnpm dev
```

2. Keep Telegram disabled while you change the product shape.

```env
TELEGRAM_BOT_ENABLED="false"
TELEGRAM_MTPROTO_ENABLED="false"
TELEGRAM_SEND_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="false"
```

3. Customize the CRM around synthetic data before adding external integrations.

4. Add a throwaway Telegram bot, Telegram API app, and Telegram user only after
   the local app works and you understand the session risk.

## Product Areas To Customize

| Product area | Start here | Notes |
| --- | --- | --- |
| Dashboard navigation | `apps/web/src/components/app-sidebar.tsx` | Add or remove modules for your CRM workflow. |
| Contacts | `apps/web/src/app/(dashboard)/contacts`, `packages/db/src/schema/contacts.ts` | Keep workspace scoping and encrypted fields intact. |
| Deals or pipelines | `apps/web/src/app/(dashboard)/deals`, `packages/db/src/schema/deals.ts` | Rename stages/types in shared schemas and migrations together. |
| Goals and follow-ups | `apps/web/src/app/(dashboard)/goals`, `apps/web/src/app/(dashboard)/follow-up-plans` | Useful for sales, investor relations, support, or community management. |
| Bot commands | `apps/worker/src/bot/features` | Keep commands disabled or harmless unless the related feature flags are enabled. |
| AI extraction | `apps/worker/src/ai`, `apps/worker/src/queues` | Preserve entity masking before embedding or model calls. |
| Search and knowledge | `apps/web/src/app/(dashboard)/knowledge`, `packages/db/src/dal/knowledge.ts` | Treat embeddings as sensitive because they can leak source text. |
| Settings and access | `apps/web/src/app/(dashboard)/settings`, `apps/web/src/app/actions/settings.ts` | Keep disconnect/delete flows working before enabling Telegram. |

## Security Boundaries To Preserve

Do not remove these without a threat-model review:

- workspace-derived authorization in server actions;
- `withWorkspaceRLS` and workspace-scoped DAL calls;
- `WORKER_INTERNAL_SECRET` / `INTERNAL_AUTH_SECRET` on web-to-worker calls;
- Telegram flags that keep Bot API, MTProto, and sending disabled by default;
- per-user GramJS worker threads;
- encryption of Telegram session strings before they leave the worker;
- `DEV_KMS_BYPASS` restrictions outside local demo/test environments;
- entity masking before AI embeddings or model inference;
- audit logging and rate limits for outbound Telegram sends.

## Enabling Telegram Safely

Use only throwaway resources at first:

- new Telegram bot from `@BotFather`;
- new Telegram API app;
- throwaway Telegram user account with no real contacts;
- fresh local database;
- fresh Redis/Dragonfly-compatible cache.

Enable linking before sending:

```env
TELEGRAM_BOT_ENABLED="true"
TELEGRAM_MTPROTO_ENABLED="true"
TELEGRAM_SEND_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="true"
TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"
TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="false"
TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="compat"
TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="false"
TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES="5"
TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"
TELEGRAM_API_CREDENTIAL_PROVIDER="os-keychain"
TELEGRAM_API_KEYCHAIN_ACCOUNT="telegram-api-credentials"
```

Use `TELEGRAM_SESSION_KEY_PROVIDER=os-keychain` for local macOS users. Run `pnpm telegram:keychain:harden` for existing local links so their Keychain items use `WhenUnlockedThisDeviceOnly`. `TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE=true` with `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE=strict` enables macOS `SecAccessControl.userPresence`; verify it with `pnpm telegram:touchid:probe`. Keep `TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK=false` for one user-presence unlock per import run; completed, paused, cancelled, and finally failed imports disconnect the local Telegram client while the helper thread can remain alive until the idle timeout to avoid repeated Telegram API credential prompts. If the client closes unexpectedly during a run, resume the import to approve another explicit unlock instead of prompting mid-run. Set it to `true` only if you want per-read prompts. Use `aws-kms` when you have configured AWS KMS. Do not use `dev-insecure` with real Telegram accounts.

Use `TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES=5` to terminate idle local GramJS helper threads without revoking the linked Telegram session. Completed, cancelled, and finally failed history imports disconnect the Telegram client first; idle eviction terminates the helper thread afterward. Idle eviction or a closed client stops the active run rather than silently unwrapping the session key again. Keep `TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS=false` so only the explicit history import flow can unlock the stored MTProto session.

Use `pnpm telegram:setup` to keep Telegram API app credentials in macOS Keychain
instead of `.env.local` for normal local use.

Only enable `TELEGRAM_SEND_ENABLED=true` after reviewing:

- `apps/worker/src/routes/telegram.ts`;
- per-contact and per-workspace send rate limits;
- idempotency handling;
- user confirmation UI;
- audit logs;
- global and workspace feature flags.

## Data Model Notes

The schema is intentionally broad. A smaller CRM can delete UI modules, but be
careful with shared tables:

- `workspaces`, `workspace_members`, `users`, `sessions`, and `accounts` anchor
  auth and tenant isolation;
- `contacts`, `chats`, and `messages` anchor Telegram-derived CRM data;
- `commitments`, `goals`, `deals`, `introductions`, and `recommendations` are
  product modules that can be narrowed or renamed;
- encrypted columns and blind indexes should be updated together when fields are
  added or removed.

Run migrations against a disposable database after schema changes:

```bash
pnpm db:migrate
pnpm test
```

## Public Fork Checklist

Before publishing your fork:

- remove or rewrite old business-specific copy;
- keep `.env.example` safe and Telegram-off by default;
- change every deployment app name, volume name, endpoint, and provider ID;
- rotate all credentials used while developing privately;
- run a full-history secret scan;
- run `pnpm audit:open-source`;
- run `pnpm audit`;
- run `pnpm audit --prod`;
- run `pnpm lint`, `pnpm typecheck`, and `pnpm test`;
- document which Telegram features your fork supports and which remain disabled.

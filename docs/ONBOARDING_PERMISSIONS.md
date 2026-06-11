# Onboarding Permissions

This page explains the consent and safety choices shown during local onboarding.
It is written for users cloning the repository and connecting a personal or side
Telegram account on their own Mac.

## Flow

1. **Connect Telegram**
   - Enter the Telegram phone number.
   - Acknowledge that Gordian creates a local Telegram MTProto session.
   - Request and enter the Telegram verification code.
   - If Telegram asks for Two-Step Verification, enter that password in the
     browser. Do not paste it into issues, chats, or pull requests.

2. **Choose Permissions**
   - **Telegram read access** is required for imports. Message sending remains
     disabled in the public/local default setup.
   - **Local data processing** is required so Gordian can store, index, and show
     imported CRM data in the local workspace.
   - **AI analysis** is optional and off by default. When enabled, eligible
     imported messages may be summarized, embedded, classified, or used by local
     relationship/draft features according to the configured providers.

3. **Start Import**
   - In import-only personal mode, the dashboard history import is the only flow
     allowed to open the stored MTProto session.
   - Large import confirmation, older-history backfill, and run-AI-during-import
     remain action-time controls. They are intentionally not silently persisted
     as broad future permissions.

## What Persists

The following choices are saved in the workspace consent row:

- data processing consent;
- Telegram read-access consent;
- AI analysis consent;
- consent version and timestamp.

The following choices are not silently reused:

- large import confirmation;
- backfill older history;
- outbound message sending permission.

Outbound Telegram sending is disabled in the public/local default setup. Any
future sending feature should require a separate prompt-scoped threat model and
tests.

## Touch ID And MTProto Session Custody

Touch ID for the high-risk Telegram MTProto session is configured before browser
onboarding:

```bash
pnpm telegram:setup
pnpm telegram:touchid:probe
pnpm telegram:doctor
```

`pnpm telegram:setup` stores the Telegram API app credentials in macOS Keychain
instead of `.env.local`. `pnpm telegram:touchid:probe` verifies whether strict
macOS user-presence gating works on the current Mac. `pnpm telegram:doctor`
checks local-only Postgres/Redis URLs, Keychain access, read-only Telegram
flags, and FileVault readiness.

In the preferred local personal-account mode:

```env
TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"
TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="true"
TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="strict"
TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"
TELEGRAM_SEND_ENABLED="false"
TELEGRAM_FULL_BACKFILL_ENABLED="false"
TELEGRAM_PERIODIC_SYNC_ENABLED="false"
```

With this setup, the database stores the encrypted MTProto session plus a
Keychain marker. The unwrap key stays in macOS Keychain. The worker opens the
session for an explicit import run, disconnects at terminal states, and evicts
idle helper threads after the configured memory window.

## macOS Local Database Protection

Gordian encrypts sensitive workspace fields before they are stored in Postgres.
For real local workspaces, use:

```env
WORKSPACE_KEY_PROVIDER="os-keychain"
```

That keeps workspace root keys in macOS Keychain instead of the database.
FileVault still matters because local Postgres data files, indexes, logs, and
scratch files live on disk. `pnpm telegram:doctor` reports whether FileVault and
the local runtime checks pass on the current Mac.

For the stricter MTProto setup details, see
[`docs/MACOS_TOUCH_ID_MTPROTO.md`](./MACOS_TOUCH_ID_MTPROTO.md). For full
personal-account setup, see
[`docs/TELEGRAM_PERSONAL_ACCOUNT.md`](./TELEGRAM_PERSONAL_ACCOUNT.md).

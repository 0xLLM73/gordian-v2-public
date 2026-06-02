# Personal Telegram Account Safety

Gordian can be tested with a personal Telegram account only in local, read-only mode. Do not enable hosted access, outbound sends, full-history backfill, or periodic sync unless those features have their own threat model and tests. Group sync is limited to the explicit onboarding import scope.

## Normal macOS Setup

1. Enable Telegram Two-Step Verification in Telegram.
2. Create a dedicated Telegram API app at
   [my.telegram.org/apps](https://my.telegram.org/apps). Sign in with the side
   Telegram account, create or open an API development app, then copy `api_id`
   and `api_hash` into `pnpm telegram:setup`.

   Known-good API app form values:

   ```text
   App title: Gordian Local
   Short name: gordianlocaltest73
   URL: https://github.com/0xLLM73/gordian-v2-public
   Platform: Desktop
   Description: Local read-only Telegram account sync test for Gordian.
   ```

   If the short name is already taken, append a few random digits.
3. Start from the synthetic local demo setup:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm demo:setup
```

4. Configure local Telegram mode:

```bash
pnpm telegram:setup
pnpm telegram:doctor
```

`pnpm telegram:setup` shows the
[my.telegram.org/apps](https://my.telegram.org/apps) URL, prompts for
`TELEGRAM_API_ID` and `TELEGRAM_API_HASH`, stores them in macOS Keychain by
default, enables MTProto and the linking UI, switches Telegram session-key
protection to macOS Keychain, clears AWS/KMS variables used by the Telegram
session-key path, and keeps read-only safety flags disabled. Interactive setup
hides both values while typed and does not print the API ID or API hash after
saving them.

`pnpm telegram:doctor` must report zero failures before a personal account is
connected. It checks that local Telegram mode is read-only, no AWS credentials
are active for this path, no secret-like `NEXT_PUBLIC_` variables are set,
Postgres and Redis point at localhost, and macOS Keychain can store and read a
temporary key. In Keychain mode it also fails if `TELEGRAM_API_ID` or
`TELEGRAM_API_HASH` still have values in `.env.local`.

## Required Local Flags

```env
TELEGRAM_MTPROTO_ENABLED="true"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="true"
TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"
TELEGRAM_KEYCHAIN_SERVICE="gordian-v2-telegram"
TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="false"
TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="compat"
TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="false"
TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES="5"
TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"
TELEGRAM_API_CREDENTIAL_PROVIDER="os-keychain"
TELEGRAM_API_KEYCHAIN_ACCOUNT="telegram-api-credentials"
TELEGRAM_SEND_ENABLED="false"
TELEGRAM_FULL_BACKFILL_ENABLED="false"
TELEGRAM_PERIODIC_SYNC_ENABLED="false"
```

Use a dedicated Telegram API app from `my.telegram.org`. For normal macOS local
use, keep `TELEGRAM_API_CREDENTIAL_PROVIDER="os-keychain"` so `TELEGRAM_API_ID`
and `TELEGRAM_API_HASH` live in macOS Keychain instead of `.env.local`. Never
prefix Telegram credentials with `NEXT_PUBLIC_`.

Group messages are imported only when the user explicitly selects the group
import scope during onboarding.

## Protecting The MTProto Session

Saved GramJS MTProto sessions are account credentials. A normal local user should choose one of these session-key providers before enabling `TELEGRAM_MTPROTO_ENABLED`:

| Provider | Best For | What Is Stored In Postgres |
|----------|----------|-----------------------------|
| `TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"` | Local macOS use where web and worker run as the same OS user | The encrypted MTProto session plus a Keychain marker. The unwrap key stays in macOS Keychain under `TELEGRAM_KEYCHAIN_SERVICE`. `pnpm telegram:keychain:harden` re-stores existing items as `WhenUnlockedThisDeviceOnly`; per-access user-presence requires signed/native packaging on some macOS setups. |
| `TELEGRAM_SESSION_KEY_PROVIDER="aws-kms"` | Cloud/advanced local setups | The encrypted MTProto session plus an AWS KMS data-key ciphertext blob. |

`TELEGRAM_SESSION_KEY_PROVIDER="dev-insecure"` is only for synthetic local demos and tests. It stores the session unwrap key beside the encrypted session and the worker refuses to start MTProto with that provider.

`TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES` controls how long the local GramJS helper thread may stay alive after the last action. During an active import it may hold a connected Telegram client/session; terminal import cleanup disconnects that client, and idle eviction later terminates the helper thread. Use `5` for personal-account testing. When the worker is evicted, the encrypted session remains linked in Postgres. The active import run will not silently read the Keychain unwrap key again; resume the import to perform a new explicit user-presence unlock. This is not a Telegram-side revocation.

For local personal-account testing on macOS, set `TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"` so Telegram session keys are not stored in the database. Run `pnpm telegram:keychain:harden` after changing this setting so existing linked Telegram sessions are re-stored with the stricter `WhenUnlockedThisDeviceOnly` Keychain accessibility policy. Also prefer `WORKSPACE_KEY_PROVIDER="os-keychain"` for real local workspaces so saved Telegram messages and derived data are encrypted with a workspace root key held in macOS Keychain. Existing local dev workspaces that still use raw `DEV_KMS_BYPASS` keys can be moved with `pnpm workspace-key:migrate-local-keychain -- --apply`. macOS protects these Keychain items behind the user's login keychain and FileVault posture.

`TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="true"` enables an additional user-presence path for Telegram session unwrap. Use `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="strict"` for macOS `SecAccessControl.userPresence`; run `pnpm telegram:touchid:probe` before relying on it. `GORDIAN_KEYCHAIN_HELPER_PATH` is optional and only points strict reads through a branded native helper so macOS prompts say Gordian instead of a temporary helper name. Keep `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="compat"` only as a fallback when strict user-presence probing fails. For the full open-source setup, see [macOS Touch ID for Telegram MTProto](./MACOS_TOUCH_ID_MTPROTO.md).

Keep `TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="false"` for the normal personal-account flow. The import requires user presence when the run starts or resumes, then the local worker keeps the Telegram client open only for that import run and disconnects it when the run completes, pauses, cancels, or finally fails. The helper thread may remain alive until the idle timeout so repeat imports do not repeatedly read Telegram API credentials from Keychain. If that client closes unexpectedly during a run, the run stops with a resume-required message instead of prompting again mid-run. Set it to `"true"` only if you intentionally want the stricter per-read mode and accept repeated Touch ID prompts during large imports.

Keep `TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"` for personal accounts. That prevents legacy contact sync/backfill workers from opening the stored MTProto session key; the history import flow remains the explicit path that can unlock the session.

`WORKSPACE_KEY_CACHE_TTL_MINUTES` controls usability after the app reads the workspace root key from Keychain. A value like `60` avoids repeated Keychain reads during active local analysis while keeping Postgres from storing the key itself.

For AWS KMS advanced setups, set:

```env
TELEGRAM_SESSION_KEY_PROVIDER="aws-kms"
KMS_CMK_ARN="arn:aws:kms:..."
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="<aws access key id>"
AWS_SECRET_ACCESS_KEY="<aws secret access key>"
```

A normal local macOS user does not need to link an AWS account. The setup and
doctor commands are intentionally biased toward `os-keychain`, so an old AWS
account cannot be used for Telegram session-key custody unless the user manually
switches providers and configures AWS credentials.

## User Flow

1. Enable Telegram Two-Step Verification in Telegram.
2. Start Gordian locally with local Postgres and local Redis only.
3. Connect Telegram from the onboarding flow.
4. Choose the smallest useful import scope. Start with `Contacts only`.
5. Leave AI analysis off unless you understand which configured providers may receive derived message content. For OpenAI embeddings, prefer `pnpm openai:setup` so the API key lives in macOS Keychain.
6. Confirm the settings page shows `Read-only`.

The onboarding flow does not start contact or message sync automatically after verification. The user must choose an import scope and click `Start selected import`.

## What The Default Personal Mode Prevents

- No Telegram message sending.
- No group or supergroup participant import.
- No full-history backfill.
- No 15-minute background sync.
- No AI summaries, embeddings, deal detection, or token detection unless the user opts in during import.

## Disconnect And Revoke

Disconnecting in Gordian removes the local encrypted MTProto session, deletes the local OS Keychain session key when that provider is used, and terminates the local GramJS worker session. It does not revoke the session inside Telegram.

After disconnecting, open Telegram Settings > Devices and terminate the Gordian session. If the device is no longer trusted, delete the local `.env.local`, local database, and Redis data used for the test.

## Local Security Smoke

Run the security smoke before and after a real import. It prints only check names
and counts, never secret values.

```bash
pnpm telegram:security-smoke
```

The smoke verifies:

- `os-keychain` custody for Telegram API credentials and MTProto session unwrap keys;
- local-only Postgres/Redis/worker endpoints;
- the worker `/telegram/send-message` route returns `503` while sending is disabled;
- Telegram account rows store Keychain markers and encrypted-looking session ciphertext;
- sampled message text is encrypted-looking ciphertext;
- volatile Redis auth/send/session-lock keys are absent or called out.

After disconnecting and running `pnpm purge:secrets -- --confirm`, verify local
residue is gone:

```bash
pnpm telegram:security-smoke --expect-purged
```

## Release Gate

Before recommending this flow to another user, run:

```bash
pnpm telegram:doctor
pnpm telegram:security-smoke
pnpm lint
pnpm typecheck
pnpm test
pnpm demo:smoke
```

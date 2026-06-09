# macOS Touch ID for Telegram MTProto

Gordian treats a saved Telegram MTProto session as high-risk account access. In local macOS mode, the encrypted Telegram session stays in Postgres, but its unwrap key is stored in macOS Keychain. Strict Touch ID mode tightens that Keychain item with macOS `SecAccessControl.userPresence`.

This repository can stay fully open source. The source code, helper source, build scripts, and setup docs are public. Apple signing certificates, private keys, notarization credentials, exported `.p12` files, and app-specific passwords must remain private and must never be committed.

## Runtime Policy

For personal Telegram accounts, use:

```bash
TELEGRAM_MTPROTO_ENABLED="true"
TELEGRAM_SEND_ENABLED="false"
TELEGRAM_PERIODIC_SYNC_ENABLED="false"
TELEGRAM_SESSION_KEY_PROVIDER="os-keychain"
TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="true"
TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="strict"
TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="false"
TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"
POSTGRES_TEMP_FILE_LIMIT="256MB"
```

`TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK=false` makes each history-import run follow this sequence:

1. Read the Telegram session unwrap key from Keychain when the run starts or resumes.
2. Decrypt the stored session.
3. Connect the dedicated GramJS worker.
4. Run the MTProto operations for that import run.
5. Disconnect the Telegram client when the run completes, pauses, cancels, or finally fails. The helper thread may stay alive until the idle timeout so repeat imports do not re-read Telegram API credentials from Keychain.

When strict Touch ID is available, step 1 is the import-session Touch ID/password gate. If the connected GramJS client closes unexpectedly during a default per-import run, the run stops with a resume-required message instead of silently reading the Keychain unwrap key again. Set `TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK=true` only if you want every MTProto read to repeat the unlock/connect/use/disconnect sequence. Outbound Telegram sends stay disabled while strict local custody is enforced; sending would need a separate prompt-scoped design.

When `GORDIAN_KEYCHAIN_HELPER_PATH` is configured, setup scripts and the worker
also use that helper for Telegram API app credential reads and writes in
standard Keychain mode. After enabling the helper for an existing install, run
`pnpm telegram:api-keychain:harden -- --apply` once to re-store that credential
with the stable helper identity. This keeps import clicks from falling back to
temporary Swift helpers or the macOS `security` CLI for API credentials, which
can otherwise show separate login-keychain password prompts. The API credentials
do not unlock a Telegram account by themselves; the saved MTProto session key
remains protected by the strict user-presence item.

## Recommended Architecture

The strict local design is:

```text
Gordian local worker
├── macOS Keychain item protected by SecAccessControl.userPresence
└── optional GordianKeychainBroker.app for branded prompts/distribution
```

Only the Keychain helper reads or writes the Telegram session unwrap key. It stores the key as a generic password item with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and `SecAccessControl.userPresence`. The worker receives only the plaintext key needed to decrypt the saved session for the explicit import operation, then disconnects the Telegram client when the import reaches a terminal state. Idle eviction terminates the helper thread afterward.

The Xcode-built broker is optional for local development. It gives macOS a stable Gordian app identity for prompts and is the right shape for public distribution, but strict local probing does not require your Apple signing identity. Developer ID is for public distribution.

## Open-Source User Paths

Outside users have four valid paths:

1. **Official signed release**: use a release where the app/helper is signed by the Gordian maintainer. Users do not receive or need the maintainer's certificate.
2. **Local source build**: clone the repo and run `pnpm telegram:touchid:probe`. If the probe passes, strict local user-presence gating is available.
3. **Optional local broker build**: build `GordianKeychainBroker.app` with Xcode automatic signing when you want macOS prompts to identify Gordian consistently.
4. **Compat mode**: keep `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE=compat` only when strict user-presence probing fails. This keeps the session unwrap key in Keychain but does not provide strict `SecAccessControl.userPresence`.

Apple documents Developer ID as the certificate path for apps distributed outside the Mac App Store, and Apple recommends notarization for Developer ID-signed macOS software. See Apple Developer's [Developer ID](https://developer.apple.com/support/developer-id/), [Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/), and [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution). For local development, use Xcode automatic signing with a Personal Team when available.

## Local Strict Setup

1. Enable strict local policy:

```bash
TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="true"
TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="strict"
TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="false"
TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"
```

2. Verify strict user-presence works on this Mac:

```bash
pnpm telegram:touchid:probe
```

3. Re-store existing Telegram session keys with the current policy:

```bash
pnpm telegram:keychain:harden
```

4. Restart local processes and verify:

```bash
pnpm telegram:doctor -- --allow-missing-credentials
```

The Settings page should show `Strict Touch ID requested` and `MTProto session reuse: Per import run`.
The doctor also reports FileVault status and whether `POSTGRES_TEMP_FILE_LIMIT`
is configured. FileVault protects Postgres data and scratch files at the local
volume layer; the temp-file limit only caps scratch-file growth and does not
encrypt files by itself.

## Optional Branded Broker

The optional broker is useful when you want macOS prompts to say Gordian instead of a temporary helper name, or when preparing a signed release. It is not required for local strict-mode security.

There are two local broker shapes:

- A stable signed executable, built with `pnpm keychain-helper:build -- --out ... --identity auto`, works for standard and compat Keychain reads and avoids temporary Swift helper files.
- Strict `SecAccessControl.userPresence` needs an app-bundle broker with `com.apple.application-identifier`, `com.apple.developer.team-identifier`, `keychain-access-groups`, and a matching embedded provisioning profile. Without that profile, macOS may return `errSecMissingEntitlement` (`-34018`) or kill the helper before it starts.

1. Install full Xcode, open **Xcode > Settings > Accounts**, add your Apple Account, and let Xcode create a Personal Team signing identity. A paid Developer ID certificate is not required for the local proof of concept. If command-line `xcodebuild` says `No Accounts`, open Xcode and add the account there before trying to build the strict app-bundle broker.

2. Generate the local Xcode broker project:

```bash
pnpm keychain-helper:xcode-project
```

This writes a disposable project outside the repo at `~/Library/Application Support/Gordian/GordianKeychainBrokerXcode/`. The generated entitlements use Xcode signing variables for the application identifier, development team, and Keychain access group so Xcode-managed profiles can resolve them consistently for the selected Personal Team. Open `GordianKeychainBroker.xcodeproj` in Xcode, select the `GordianKeychainBroker` target, choose your Personal Team under **Signing & Capabilities**, and build the Debug target.

If Team ID detection fails, pass your Personal Team ID explicitly. This seeds
the generated project's `DEVELOPMENT_TEAM`; Xcode still resolves the final
entitlement values during signing:

```bash
pnpm keychain-helper:xcode-project -- --clean --team-id 1A2B3C4D5E
```

If Xcode says the bundle identifier is unavailable, rerun the generator with a locally unique id, for example:

```bash
pnpm keychain-helper:xcode-project -- --clean --bundle-id dev.gordian.KeychainBroker.yourname
```

3. Add the executable path to `.env.local`:

```bash
GORDIAN_KEYCHAIN_HELPER_PATH="/Users/you/Library/Application Support/Gordian/GordianKeychainBrokerXcode/Build/Products/Debug/GordianKeychainBroker.app/Contents/MacOS/GordianKeychainBroker"
```

4. Verify the broker:

```bash
pnpm keychain-helper:doctor -- --require-strict-ready
pnpm telegram:touchid:probe
```

`keychain-helper:doctor -- --require-strict-ready` must show the application
identifier and Keychain access-group checks as passing before strict mode should
be trusted. If it fails, keep `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="compat"`
and continue using the stable helper path until the app-bundle broker is fixed.

5. For an existing local install, re-store the Telegram API app credential with
   the broker identity:

```bash
pnpm telegram:api-keychain:harden -- --apply
```

This command reads the existing credential, deletes the old item, and re-adds it
through `GORDIAN_KEYCHAIN_HELPER_PATH`. It never prints the Telegram API ID or
hash. It is separate from `pnpm telegram:keychain:harden`, which re-stores the
high-risk MTProto session unwrap keys with the current Touch ID policy.

## Rollback And Recovery

The broker path is an access path to Keychain, not the source of truth for
Telegram messages. If a new local broker build behaves badly:

1. Stop the local web and worker processes.
2. Remove or blank `GORDIAN_KEYCHAIN_HELPER_PATH` in `.env.local`.
3. If strict broker prompts are the problem, temporarily set:

```bash
TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="compat"
```

4. Restart the app and run:

```bash
pnpm telegram:doctor -- --allow-missing-credentials
```

5. To return to the checkpoint before broker changes, use the Git commit you
created before starting the broker work. Do not delete Keychain items unless
you are intentionally disconnecting Telegram; deleting the helper app or
clearing `GORDIAN_KEYCHAIN_HELPER_PATH` is enough to stop using that broker.

## Maintainer Release Notes

For a distributed macOS app, sign the main app and broker with the maintainer's Developer ID Application certificate, enable hardened runtime where appropriate, and notarize the release artifact. Keep all signing assets outside the repository and CI logs. Public forks that distribute binaries should use their own Apple Developer account and signing identity.

Do not commit:

- `.p12` certificate exports.
- Private keys.
- Apple app-specific passwords.
- Notarization profiles or API-key `.p8` files.
- Real Telegram API IDs, API hashes, bot tokens, or saved GramJS sessions.

The open-source audit rejects common secret patterns and sensitive signing-file extensions, but maintainers should still run GitHub secret scanning and review release artifacts before publishing.

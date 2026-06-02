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
```

`TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK=false` makes each history-import run follow this sequence:

1. Read the Telegram session unwrap key from Keychain when the run starts or resumes.
2. Decrypt the stored session.
3. Connect the dedicated GramJS worker.
4. Run the MTProto operations for that import run.
5. Disconnect the Telegram client when the run completes, pauses, cancels, or finally fails. The helper thread may stay alive until the idle timeout so repeat imports do not re-read Telegram API credentials from Keychain.

When strict Touch ID is available, step 1 is the import-session Touch ID/password gate. If the connected GramJS client closes unexpectedly during a default per-import run, the run stops with a resume-required message instead of silently reading the Keychain unwrap key again. Set `TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK=true` only if you want every MTProto read to repeat the unlock/connect/use/disconnect sequence. Outbound Telegram sends stay disabled while strict local custody is enforced; sending would need a separate prompt-scoped design.

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

Outside users have three valid paths:

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

## Optional Branded Broker

The optional broker is useful when you want macOS prompts to say Gordian instead of a temporary helper name, or when preparing a signed release. It is not required for local strict-mode security.

1. Install full Xcode, open **Xcode > Settings > Accounts**, add your Apple Account, and let Xcode create a Personal Team signing identity. A paid Developer ID certificate is not required for the local proof of concept.

2. Generate the local Xcode broker project:

```bash
pnpm keychain-helper:xcode-project
```

This writes a disposable project outside the repo at `~/Library/Application Support/Gordian/GordianKeychainBrokerXcode/`. On macOS, the generator tries to detect your Apple Development Team ID from local certificate metadata and writes concrete local entitlements into that generated project. Open `GordianKeychainBroker.xcodeproj` in Xcode, select the `GordianKeychainBroker` target, choose your Personal Team under **Signing & Capabilities**, and build the Debug target.

If Team ID detection fails, pass your Personal Team ID explicitly:

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

## Maintainer Release Notes

For a distributed macOS app, sign the main app and broker with the maintainer's Developer ID Application certificate, enable hardened runtime where appropriate, and notarize the release artifact. Keep all signing assets outside the repository and CI logs. Public forks that distribute binaries should use their own Apple Developer account and signing identity.

Do not commit:

- `.p12` certificate exports.
- Private keys.
- Apple app-specific passwords.
- Notarization profiles or API-key `.p8` files.
- Real Telegram API IDs, API hashes, bot tokens, or saved GramJS sessions.

The open-source audit rejects common secret patterns and sensitive signing-file extensions, but maintainers should still run GitHub secret scanning and review release artifacts before publishing.

#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from './lib/telegram-local-mode.mjs';

const execFileAsync = promisify(execFile);

function usage() {
	console.log(`Usage: pnpm keychain-helper:build [options]

Builds the native Gordian Keychain helper. Strict Telegram Touch ID mode can use
a temporary helper, but an app-like helper gives macOS a stable Gordian prompt
identity and is the right shape for distribution.

Options:
  --out <path>           Output path. Defaults to .local/bin/gordian-keychain-helper,
                         or ~/Library/Application Support/Gordian/GordianKeychainBroker.app
                         with --app-bundle on macOS.
  --identity <name>      codesign identity. Use "auto" to select the first valid identity.
  --entitlements <path>  Optional entitlements plist for codesign.
  --app-bundle           Build an app-like helper bundle instead of a naked binary.
  --bundle-id <id>       Bundle id for --app-bundle. Defaults to dev.gordian.KeychainBroker.
  --list-identities      Print valid local code-signing identities and exit.
  --help                 Show this help text.
`);
}

async function listCodeSigningIdentities() {
	const { stdout } = await execFileAsync('security', ['find-identity', '-v', '-p', 'codesigning']);
	return stdout
		.split(/\r?\n/)
		.map((line) => {
			const match = line.match(/^\s*\d+\)\s+([A-Fa-f0-9]+)\s+"(.+)"$/);
			if (!match) return null;
			return { hash: match[1], name: match[2] };
		})
		.filter(Boolean);
}

function helperInfoPlist(bundleId) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>en</string>
\t<key>CFBundleExecutable</key>
\t<string>gordian-keychain-helper</string>
\t<key>CFBundleIdentifier</key>
\t<string>${bundleId}</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>Gordian Keychain Broker</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0</string>
\t<key>CFBundleVersion</key>
\t<string>1</string>
\t<key>LSUIElement</key>
\t<true/>
</dict>
</plist>
`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}
	if (args['list-identities']) {
		const identities = await listCodeSigningIdentities();
		if (identities.length === 0) {
			console.log('[keychain-helper:build] No valid code-signing identities found.');
			return;
		}
		for (const identity of identities) {
			console.log(`${identity.hash} ${identity.name}`);
		}
		return;
	}

	const source = resolve('scripts/native/gordian-keychain-helper.swift');
	const appBundle = Boolean(args['app-bundle']);
	const bundleId = String(args['bundle-id'] || 'dev.gordian.KeychainBroker');
	const defaultAppBundleOut =
		process.platform === 'darwin'
			? resolve(homedir(), 'Library/Application Support/Gordian/GordianKeychainBroker.app')
			: '.local/GordianKeychainBroker.app';
	const out = resolve(
		String(args.out || (appBundle ? defaultAppBundleOut : '.local/bin/gordian-keychain-helper')),
	);
	const binaryOut = appBundle ? resolve(out, 'Contents/MacOS/gordian-keychain-helper') : out;
	const moduleCachePath = resolve(tmpdir(), 'gordian-swift-module-cache');
	if (appBundle) {
		rmSync(out, { force: true, recursive: true });
	}
	mkdirSync(dirname(binaryOut), { recursive: true });
	mkdirSync(moduleCachePath, { recursive: true });
	if (appBundle) {
		mkdirSync(resolve(out, 'Contents'), { recursive: true });
		writeFileSync(resolve(out, 'Contents/Info.plist'), helperInfoPlist(bundleId));
	}

	let identity = args.identity ? String(args.identity) : '';
	if (identity === 'auto') {
		const identities = await listCodeSigningIdentities();
		if (identities.length === 0) {
			throw new Error(
				'No valid code-signing identities found. Install full Xcode and create a Personal Team/Apple Development identity, then rerun pnpm keychain-helper:build -- --app-bundle --identity auto.',
			);
		}
		identity = identities[0].name;
		console.log(`[keychain-helper:build] Using code-signing identity "${identity}"`);
	}

	await execFileAsync('swiftc', ['-module-cache-path', moduleCachePath, source, '-o', binaryOut]);

	if (identity) {
		if (appBundle) {
			await execFileAsync('xattr', ['-cr', out]).catch(() => {});
		}
		const codesignArgs = ['--force', '--sign', identity];
		if (args.entitlements) {
			codesignArgs.push('--entitlements', resolve(String(args.entitlements)));
		}
		codesignArgs.push(appBundle ? out : binaryOut);
		await execFileAsync('codesign', codesignArgs);
		console.log(`[keychain-helper:build] Built and signed ${appBundle ? out : binaryOut}`);
	} else {
		console.log(`[keychain-helper:build] Built unsigned helper at ${appBundle ? out : binaryOut}`);
		console.log(
			'[keychain-helper:build] Unsigned helpers can be used for local probing, but signed app-like helpers give macOS a stable Gordian prompt identity.',
		);
	}

	console.log(
		`Optionally set GORDIAN_KEYCHAIN_HELPER_PATH="${binaryOut}" before running strict mode.`,
	);
	if (appBundle) {
		console.log(
			'Run pnpm telegram:touchid:probe before relying on TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE=strict.',
		);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

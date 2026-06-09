#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
	DEFAULT_ENV_PATH,
	envValue,
	parseArgs,
	parseEnvText,
	readEnvText,
} from './lib/telegram-local-mode.mjs';

const execFileAsync = promisify(execFile);

function usage() {
	console.log(`Usage: pnpm keychain-helper:doctor [options]

Checks whether this Mac is ready to build and run the strict Gordian Keychain
helper used by TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE=strict. Strict local mode
should use a signed app-like helper bundle, not a naked ad-hoc CLI.

Options:
  --env <path>                Env file to inspect. Defaults to .env.local.
  --helper <path>             Helper binary path. Defaults to GORDIAN_KEYCHAIN_HELPER_PATH.
  --require-strict-ready      Fail if helper path/signature requirements are not satisfied.
  --help                      Show this help text.
`);
}

function printChecks(checks) {
	for (const check of checks) {
		const label = check.level.toUpperCase().padEnd(4, ' ');
		console.log(`${label} ${check.name}: ${check.detail}`);
	}
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

function codeSignTargetForHelperPath(helperPath) {
	const match = helperPath.match(/^(.+?\.app)\/Contents\/MacOS\/[^/]+$/);
	return match ? match[1] : helperPath;
}

async function readCodesignDetails(helperPath) {
	const target = codeSignTargetForHelperPath(helperPath);
	let verifyError = '';
	try {
		await execFileAsync('codesign', ['--verify', '--strict', '--verbose=2', target]);
	} catch (error) {
		verifyError = error instanceof Error ? error.message : String(error);
	}
	const { stderr } = await execFileAsync('codesign', ['-dv', '--verbose=4', target]);
	return { details: String(stderr), verifyError };
}

function appBundlePathForHelper(helperPath) {
	const match = helperPath.match(/^(.+?\.app)\/Contents\/MacOS\/[^/]+$/);
	return match ? match[1] : '';
}

async function readEntitlements(helperPath) {
	const target = codeSignTargetForHelperPath(helperPath);
	const { stdout, stderr } = await execFileAsync('codesign', [
		'--display',
		'--entitlements',
		'-',
		target,
	]);
	return `${stdout}${stderr}`;
}

async function readProvisioningProfile(profilePath) {
	const { stdout } = await execFileAsync('security', ['cms', '-D', '-i', profilePath]);
	return String(stdout);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const env = parseEnvText(readEnvText(envPath));
	const helperPath = String(
		args.helper ||
			envValue(env, 'GORDIAN_KEYCHAIN_HELPER_PATH') ||
			process.env.GORDIAN_KEYCHAIN_HELPER_PATH ||
			'',
	);
	const requireStrictReady =
		Boolean(args['require-strict-ready']) ||
		(envValue(env, 'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE') === 'true' &&
			envValue(env, 'TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE') === 'strict');
	const checks = [];
	const add = (level, name, detail) => checks.push({ detail, level, name });

	if (process.platform !== 'darwin') {
		add('fail', 'macOS', 'strict Keychain Touch ID mode requires macOS');
	} else {
		add('pass', 'macOS', 'running on Darwin');
	}

	if (process.platform === 'darwin') {
		try {
			const identities = await listCodeSigningIdentities();
			if (identities.length > 0) {
				add(
					'pass',
					'Code-signing identities',
					`${identities.length} valid identity/identities available`,
				);
			} else {
				add(
					'warn',
					'Code-signing identities',
					'none found; install full Xcode and create a Personal Team/Apple Development identity, or use Developer ID for release signing',
				);
			}
		} catch (error) {
			add(
				'warn',
				'Code-signing identities',
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	if (!helperPath) {
		add(
			'warn',
			'GORDIAN_KEYCHAIN_HELPER_PATH',
			'not configured; strict mode can still use a temporary local helper, but prompts may not show the Gordian app name',
		);
	} else if (!existsSync(helperPath)) {
		add('fail', 'GORDIAN_KEYCHAIN_HELPER_PATH', `${helperPath} does not exist`);
	} else {
		add('pass', 'GORDIAN_KEYCHAIN_HELPER_PATH', helperPath);
		const appBundlePath = appBundlePathForHelper(helperPath);
		let embeddedProfile = '';
		let hasEmbeddedProfile = false;
		if (appBundlePath) {
			add('pass', 'Helper bundle shape', 'helper executable is inside an app-like bundle');
			embeddedProfile = join(appBundlePath, 'Contents', 'embedded.provisionprofile');
			if (existsSync(embeddedProfile)) {
				hasEmbeddedProfile = true;
				add('pass', 'Helper provisioning profile', 'embedded profile is present');
			} else {
				add(
					'warn',
					'Helper provisioning profile',
					'missing embedded provisioning profile; this is acceptable for local probing but less useful for distributed helper packaging',
				);
			}
		} else {
			add(
				'warn',
				'Helper bundle shape',
				'helper is a naked executable; local strict mode should use pnpm keychain-helper:build -- --app-bundle and Xcode/Personal Team signing',
			);
		}
		try {
			const { details, verifyError } = await readCodesignDetails(helperPath);
			if (/Signature=adhoc/i.test(details)) {
				add(
					'warn',
					'Helper signature',
					'ad-hoc signed; acceptable for local probing, but use Apple signing for distributed helper packaging',
				);
			} else if (/TeamIdentifier=not set/i.test(details) || !/TeamIdentifier=/i.test(details)) {
				add(
					'warn',
					'Helper team identity',
					'signature has no TeamIdentifier; prompts may not show a stable Gordian app identity',
				);
			} else if (verifyError) {
				add(
					hasEmbeddedProfile ? 'warn' : requireStrictReady ? 'fail' : 'warn',
					'Helper signature verification',
					`${verifyError}; local Personal Team profiles can still work, but pnpm telegram:touchid:probe must pass`,
				);
				const authority =
					details
						.split(/\r?\n/)
						.find((line) => line.startsWith('Authority='))
						?.replace('Authority=', '') || 'signed';
				const team =
					details
						.split(/\r?\n/)
						.find((line) => line.startsWith('TeamIdentifier='))
						?.replace('TeamIdentifier=', '') || 'unknown';
				add('pass', 'Helper team identity', team);
				if (authority && authority !== '(unavailable)') {
					add('pass', 'Helper signing authority', authority);
				}
			} else if (/Authority=/i.test(details)) {
				const authority =
					details
						.split(/\r?\n/)
						.find((line) => line.startsWith('Authority='))
						?.replace('Authority=', '') || 'signed';
				add('pass', 'Helper signature', authority);
				const team =
					details
						.split(/\r?\n/)
						.find((line) => line.startsWith('TeamIdentifier='))
						?.replace('TeamIdentifier=', '') || 'unknown';
				add('pass', 'Helper team identity', team);
			} else {
				add(
					requireStrictReady ? 'fail' : 'warn',
					'Helper signature',
					'codesign verified but no signing authority was reported',
				);
			}
			try {
				const entitlements = await readEntitlements(helperPath);
				const hasApplicationIdentifier = /com\.apple\.application-identifier/.test(entitlements);
				const hasKeychainAccessGroup = /keychain-access-groups/.test(entitlements);
				if (hasApplicationIdentifier) {
					add('pass', 'Helper application entitlement', 'application identifier is present');
				} else if (hasEmbeddedProfile) {
					try {
						const profile = await readProvisioningProfile(embeddedProfile);
						if (/com\.apple\.application-identifier/.test(profile)) {
							add(
								'pass',
								'Helper profile entitlement',
								'application identifier is present in the embedded provisioning profile',
							);
							add(
								'warn',
								'Helper signed entitlement display',
								'codesign did not report application entitlements; pnpm telegram:touchid:probe is authoritative for local Personal Team builds',
							);
						} else {
							add(
								'warn',
								'Helper application entitlement',
								'missing com.apple.application-identifier; acceptable for local probing, but release helpers should have a stable app identity',
							);
						}
					} catch (error) {
						add(
							'warn',
							'Helper profile entitlement',
							`${error instanceof Error ? error.message : String(error)}; embedded profile exists, but pnpm telegram:touchid:probe is authoritative for local Personal Team builds`,
						);
					}
				} else {
					add(
						requireStrictReady ? 'fail' : 'warn',
						'Helper application entitlement',
						'missing com.apple.application-identifier; strict userPresence needs a profiled app identity, while compat mode can use this helper',
					);
				}
				if (hasKeychainAccessGroup) {
					add(
						'pass',
						'Helper Keychain access group',
						'keychain-access-groups entitlement is present',
					);
				} else {
					add(
						requireStrictReady ? 'fail' : 'warn',
						'Helper Keychain access group',
						'missing keychain-access-groups entitlement; strict userPresence may fail with errSecMissingEntitlement',
					);
				}
				if (requireStrictReady && appBundlePath && !hasEmbeddedProfile) {
					add(
						'fail',
						'Helper provisioning profile',
						'strict app-bundle helpers with restricted entitlements need a matching embedded provisioning profile',
					);
				}
			} catch (error) {
				add(
					requireStrictReady ? 'fail' : 'warn',
					'Helper entitlements',
					error instanceof Error ? error.message : String(error),
				);
			}
		} catch (error) {
			add(
				requireStrictReady ? 'fail' : 'warn',
				'Helper signature',
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	console.log(`Gordian Keychain helper doctor (${envPath})`);
	printChecks(checks);
	const failures = checks.filter((check) => check.level === 'fail').length;
	const warnings = checks.filter((check) => check.level === 'warn').length;
	console.log(`Summary: ${failures} failure(s), ${warnings} warning(s)`);
	if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

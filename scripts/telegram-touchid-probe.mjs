#!/usr/bin/env node

import {
	DEFAULT_ENV_PATH,
	DEFAULT_TELEGRAM_KEYCHAIN_SERVICE,
	envValue,
	parseArgs,
	parseEnvText,
	probeMacOsStrictTouchIdKeychain,
	readEnvText,
} from './lib/telegram-local-mode.mjs';

function usage() {
	console.log(`Usage: pnpm telegram:touchid:probe [options]

Verifies that this macOS user/session can create and read a temporary Telegram
Keychain item protected by SecAccessControl.userPresence. This is the strict
Touch ID/password policy we want for Telegram session unwrap keys.

Options:
  --env <path>       Env file to read. Defaults to .env.local.
  --service <name>   Keychain service. Defaults to TELEGRAM_KEYCHAIN_SERVICE.
  --helper <path>    Optional broker binary. Defaults to GORDIAN_KEYCHAIN_HELPER_PATH.
  --help             Show this help text.
`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const env = parseEnvText(readEnvText(envPath));
	const service = String(
		args.service || envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || DEFAULT_TELEGRAM_KEYCHAIN_SERVICE,
	);
	const helperPath = String(
		args.helper ||
			envValue(env, 'GORDIAN_KEYCHAIN_HELPER_PATH') ||
			process.env.GORDIAN_KEYCHAIN_HELPER_PATH ||
			'',
	);

	await probeMacOsStrictTouchIdKeychain(service, { helperPath });
	console.log(
		`[telegram-touchid-probe] Strict SecAccessControl userPresence probe passed for service ${service}${helperPath ? ` using ${helperPath}` : ''}.`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeKeychainSecret } from './lib/keychain-secret-writer.mjs';
import {
	DEFAULT_ENV_PATH,
	DEFAULT_KEYCHAIN_SERVICE,
	DEFAULT_TELEGRAM_KEYCHAIN_SERVICE,
	envValue,
	getTelegramApiKeychainAccount,
	parseArgs,
	parseEnvText,
	readEnvText,
	validateTelegramApiHash,
	validateTelegramApiId,
} from './lib/telegram-local-mode.mjs';

const execFileAsync = promisify(execFile);

function usage() {
	console.log(`Usage: pnpm telegram:api-keychain:migrate [options]

Re-homes the Telegram API app credential JSON from the legacy shared Keychain
service to the configured Telegram Keychain service without printing secrets.

Options:
  --apply                Write the credential to the target service.
  --delete-old           Delete the legacy item after target verification.
  --from-service <name>  Source service. Defaults to ${DEFAULT_KEYCHAIN_SERVICE}.
  --to-service <name>    Target service. Defaults to TELEGRAM_KEYCHAIN_SERVICE.
  --env <path>           Env file to read. Defaults to .env.local.
  --help                 Show this help text.
`);
}

async function readKeychainSecret({ account, service }) {
	const { stdout } = await execFileAsync('security', [
		'find-generic-password',
		'-a',
		account,
		'-s',
		service,
		'-w',
	]);
	return String(stdout).trim();
}

async function deleteKeychainSecret({ account, service }) {
	await execFileAsync('security', ['delete-generic-password', '-a', account, '-s', service]);
}

function validateCredentialJson(secret) {
	const parsed = JSON.parse(secret);
	const apiId = String(parsed.apiId ?? '');
	const apiHash = String(parsed.apiHash ?? '');
	if (!validateTelegramApiId(apiId) || !validateTelegramApiHash(apiHash)) {
		throw new Error('Source Keychain item did not contain valid Telegram API credentials.');
	}
}

async function existsInKeychain(target) {
	try {
		await readKeychainSecret(target);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}
	if (process.platform !== 'darwin') {
		throw new Error('Telegram API Keychain migration requires macOS Keychain.');
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const env = parseEnvText(readEnvText(envPath));
	const account = getTelegramApiKeychainAccount(env);
	const fromService = String(args['from-service'] || DEFAULT_KEYCHAIN_SERVICE);
	const toService = String(
		args['to-service'] ||
			envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') ||
			DEFAULT_TELEGRAM_KEYCHAIN_SERVICE,
	);
	const apply = Boolean(args.apply);
	const deleteOld = Boolean(args['delete-old']);

	if (fromService === toService) {
		console.log(
			`[telegram-api-keychain-migrate] Source and target are both ${toService}; nothing to do.`,
		);
		return;
	}

	const target = { account, service: toService };
	const source = { account, service: fromService };
	const targetExists = await existsInKeychain(target);
	if (targetExists) {
		console.log(
			`[telegram-api-keychain-migrate] Target credential already exists for account ${account} in service ${toService}.`,
		);
		if (deleteOld) {
			await deleteKeychainSecret(source).catch(() => {});
			console.log(
				`[telegram-api-keychain-migrate] Best-effort deleted legacy credential from service ${fromService}.`,
			);
		}
		return;
	}

	const secret = await readKeychainSecret(source);
	validateCredentialJson(secret);
	if (!apply) {
		console.log(
			`[telegram-api-keychain-migrate] Would copy account ${account} from ${fromService} to ${toService}. Re-run with --apply to write.`,
		);
		return;
	}

	await writeKeychainSecret({ account, secret, service: toService });
	validateCredentialJson(await readKeychainSecret(target));
	console.log(
		`[telegram-api-keychain-migrate] Copied account ${account} from ${fromService} to ${toService}.`,
	);

	if (deleteOld) {
		await deleteKeychainSecret(source).catch(() => {});
		console.log(
			`[telegram-api-keychain-migrate] Best-effort deleted legacy credential from service ${fromService}.`,
		);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { writeKeychainSecret } from './lib/keychain-secret-writer.mjs';
import {
	DEFAULT_ENV_PATH,
	DEFAULT_TELEGRAM_KEYCHAIN_SERVICE,
	envValue,
	getGordianKeychainHelperPath,
	getTelegramApiCredentialProvider,
	getTelegramApiKeychainAccount,
	parseArgs,
	parseEnvText,
	readEnvText,
	readTelegramApiCredentialsFromKeychain,
	validateTelegramApiHash,
	validateTelegramApiId,
} from './lib/telegram-local-mode.mjs';

const execFileAsync = promisify(execFile);

function usage() {
	console.log(`Usage: pnpm telegram:api-keychain:harden [options]

Re-stores the Telegram API app credential in macOS Keychain through the
configured Gordian Keychain helper. This is useful after adding
GORDIAN_KEYCHAIN_HELPER_PATH so import runs do not need separate login-keychain
password prompts for API credential reads.

Options:
  --apply       Read, replace, and verify the existing credential item.
  --env <path>  Env file to read. Defaults to .env.local.
  --help        Show this help text.

The Telegram API ID/hash are never printed.
`);
}

function isMissingKeychainItem(error) {
	const text = [
		error instanceof Error ? error.message : String(error),
		typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '',
	]
		.join('\n')
		.toLowerCase();
	return text.includes('could not be found') || text.includes('-25300');
}

async function deleteKeychainSecret({ account, service }) {
	try {
		await execFileAsync('security', ['delete-generic-password', '-a', account, '-s', service]);
	} catch (error) {
		if (isMissingKeychainItem(error)) return;
		throw error;
	}
}

function validateCredentials(credentials) {
	if (!validateTelegramApiId(credentials.apiId)) {
		throw new Error('Stored Telegram API ID is missing or invalid.');
	}
	if (!validateTelegramApiHash(credentials.apiHash)) {
		throw new Error('Stored Telegram API hash is missing or invalid.');
	}
}

function credentialJson(credentials) {
	return JSON.stringify({
		apiHash: credentials.apiHash.trim(),
		apiId: credentials.apiId.trim(),
		version: 1,
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}
	if (process.platform !== 'darwin') {
		throw new Error('Telegram API Keychain hardening requires macOS Keychain.');
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const env = parseEnvText(readEnvText(envPath));
	const provider = getTelegramApiCredentialProvider(env);
	if (provider !== 'os-keychain') {
		throw new Error('TELEGRAM_API_CREDENTIAL_PROVIDER must be os-keychain.');
	}

	const helperPath = getGordianKeychainHelperPath(env).trim();
	if (!helperPath) {
		throw new Error('GORDIAN_KEYCHAIN_HELPER_PATH is required for API Keychain hardening.');
	}
	if (!fs.existsSync(helperPath)) {
		throw new Error(`GORDIAN_KEYCHAIN_HELPER_PATH does not exist: ${helperPath}`);
	}

	const account = getTelegramApiKeychainAccount(env);
	const service = envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || DEFAULT_TELEGRAM_KEYCHAIN_SERVICE;
	const apply = Boolean(args.apply);

	if (!apply) {
		console.log(
			`[telegram-api-keychain-harden] Would re-store account ${account} in service ${service} with the configured Gordian helper.`,
		);
		console.log(
			'[telegram-api-keychain-harden] Re-run with --apply to write. Secrets not printed.',
		);
		return;
	}

	const credentials = await readTelegramApiCredentialsFromKeychain(env);
	validateCredentials(credentials);
	const secret = credentialJson(credentials);
	let deleted = false;

	try {
		await deleteKeychainSecret({ account, service });
		deleted = true;
		await writeKeychainSecret({
			account,
			helperPath,
			secret,
			service,
		});
	} catch (error) {
		if (deleted) {
			await writeKeychainSecret({ account, secret, service }).catch(() => {});
		}
		throw error;
	}

	const verified = await readTelegramApiCredentialsFromKeychain(env);
	validateCredentials(verified);
	if (verified.apiId !== credentials.apiId || verified.apiHash !== credentials.apiHash) {
		throw new Error('Telegram API Keychain verification read returned different credentials.');
	}

	console.log(
		`[telegram-api-keychain-harden] Re-stored account ${account} in service ${service} with the configured Gordian helper. Secrets not printed.`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

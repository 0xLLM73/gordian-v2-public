#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import { writePrivateEnvFile } from './lib/env-file.mjs';
import { materializeLocalRuntimeSecrets } from './lib/local-runtime-safety.mjs';
import {
	DEFAULT_ENV_PATH,
	envValue,
	getTelegramApiCredentialProvider,
	parseArgs,
	parseEnvText,
	readEnvText,
	TELEGRAM_LOCAL_MODE_VALUES,
	updateEnvText,
	validateTelegramApiHash,
	validateTelegramApiId,
	writeTelegramApiCredentialsToKeychain,
} from './lib/telegram-local-mode.mjs';

const TELEGRAM_API_APP_URL = 'https://my.telegram.org/apps';
const SUGGESTED_TELEGRAM_APP = {
	description: 'Local read-only Telegram account sync test for Gordian.',
	platform: 'Desktop',
	shortName: 'gordianlocaltest73',
	title: 'Gordian Local',
	url: 'https://github.com/0xLLM73/gordian-v2',
};

function printHelp() {
	console.log(`Usage: pnpm telegram:setup [options]

Writes the local, read-only Telegram settings for macOS Keychain mode.

Before running interactively:
  1. Open ${TELEGRAM_API_APP_URL}
  2. Sign in with the Telegram account you are testing.
  3. Create or open an API development app.
  4. Use these form values:
     App title: ${SUGGESTED_TELEGRAM_APP.title}
     Short name: ${SUGGESTED_TELEGRAM_APP.shortName}
     URL: ${SUGGESTED_TELEGRAM_APP.url}
     Platform: ${SUGGESTED_TELEGRAM_APP.platform}
     Description: ${SUGGESTED_TELEGRAM_APP.description}
  5. Copy api_id and api_hash into this wizard.

Options:
  --env <path>          Env file to update. Defaults to .env.local.
  --api-id <id>         Telegram API ID from my.telegram.org.
  --from-env            Read existing TELEGRAM_API_ID/HASH and migrate them to Keychain.
  --credential-provider <os-keychain|env>
                         Defaults to os-keychain. Use env only for CI or non-macOS tests.
  --dry-run             Print the keys that would change without writing.
  --help                Show this help text.

Telegram API hash is accepted only via the hidden interactive prompt or
--from-env, so it is not saved in shell history or process listings.
`);
}

function maskPresentSecret(value) {
	return value ? '[configured]' : '[blank]';
}

async function promptLine(prompt, currentValue = '') {
	const rl = readline.createInterface({ input, output });
	try {
		const suffix = currentValue ? ` (${maskPresentSecret(currentValue)}; press Enter to keep)` : '';
		const answer = await rl.question(`${prompt}${suffix}: `);
		return answer.trim() || currentValue;
	} finally {
		rl.close();
	}
}

async function promptSecret(prompt, currentValue = '') {
	if (!input.isTTY || typeof input.setRawMode !== 'function') {
		return promptLine(prompt, currentValue);
	}

	const suffix = currentValue ? ` (${maskPresentSecret(currentValue)}; press Enter to keep)` : '';
	output.write(`${prompt}${suffix}: `);

	return new Promise((resolve, reject) => {
		let value = '';
		const wasRaw = input.isRaw;
		const cleanup = () => {
			input.setRawMode(Boolean(wasRaw));
			input.off('data', onData);
			output.write('\n');
		};
		const onData = (chunk) => {
			for (const char of String(chunk)) {
				if (char === '\u0003') {
					cleanup();
					reject(new Error('Prompt cancelled'));
					return;
				}
				if (char === '\r' || char === '\n') {
					cleanup();
					resolve(value.trim() || currentValue);
					return;
				}
				if (char === '\u007f' || char === '\b') {
					value = value.slice(0, -1);
					continue;
				}
				if (char >= ' ') value += char;
			}
		};

		input.setRawMode(true);
		input.resume();
		input.setEncoding('utf8');
		input.on('data', onData);
	});
}

function changedKeys(before, after) {
	const beforeEnv = parseEnvText(before);
	const afterEnv = parseEnvText(after);
	return [...afterEnv.keys()].filter((key) => beforeEnv.get(key) !== afterEnv.get(key)).sort();
}

function loadBaseEnvText(envPath) {
	const existing = readEnvText(envPath);
	if (existing) return { createdFromExample: false, text: existing };

	const examplePath = path.resolve(process.cwd(), '.env.example');
	if (!fs.existsSync(examplePath)) {
		throw new Error(`${envPath} does not exist and .env.example was not found`);
	}

	return { createdFromExample: true, text: fs.readFileSync(examplePath, 'utf8') };
}

function printCredentialInstructions() {
	console.log('Telegram API credentials');
	console.log(`1. Open ${TELEGRAM_API_APP_URL}`);
	console.log('2. Sign in with the side Telegram account you want to test.');
	console.log('3. Create or open an API development app.');
	console.log('4. Use these form values:');
	console.log(`   App title: ${SUGGESTED_TELEGRAM_APP.title}`);
	console.log(`   Short name: ${SUGGESTED_TELEGRAM_APP.shortName}`);
	console.log('   If the short name is taken, append a few random digits.');
	console.log(`   URL: ${SUGGESTED_TELEGRAM_APP.url}`);
	console.log(`   Platform: ${SUGGESTED_TELEGRAM_APP.platform}`);
	console.log(`   Description: ${SUGGESTED_TELEGRAM_APP.description}`);
	console.log('5. Copy api_id and api_hash from that page.');
	console.log(
		'Keep both values private. This setup command stores them in macOS Keychain by default.',
	);
	console.log('Interactive prompts hide both values while you type and after saving.');
	console.log('');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const { createdFromExample, text: loadedText } = loadBaseEnvText(envPath);
	const materialized = materializeLocalRuntimeSecrets(loadedText);
	const text = materialized.text;
	const env = parseEnvText(text);

	const existingCredentialProvider = getTelegramApiCredentialProvider(env);
	if (existingCredentialProvider === 'invalid') {
		throw new Error('Existing TELEGRAM_API_CREDENTIAL_PROVIDER must be os-keychain or env');
	}
	const credentialProvider = String(args['credential-provider'] || 'os-keychain');
	if (credentialProvider !== 'os-keychain' && credentialProvider !== 'env') {
		throw new Error('--credential-provider must be os-keychain or env');
	}
	if (args['api-hash']) {
		throw new Error(
			'--api-hash is not accepted because it exposes the secret in process arguments. Run interactively or use --from-env.',
		);
	}

	if (!args['from-env'] && !args['api-id']) {
		printCredentialInstructions();
	}

	const apiId =
		args['api-id'] ||
		(args['from-env']
			? envValue(env, 'TELEGRAM_API_ID')
			: await promptSecret('Telegram API ID', envValue(env, 'TELEGRAM_API_ID')));
	const apiHash = args['from-env']
		? envValue(env, 'TELEGRAM_API_HASH')
		: await promptSecret('Telegram API hash', envValue(env, 'TELEGRAM_API_HASH'));

	if (!validateTelegramApiId(apiId)) {
		throw new Error('TELEGRAM_API_ID must be a positive integer from my.telegram.org');
	}
	if (!validateTelegramApiHash(apiHash)) {
		throw new Error('TELEGRAM_API_HASH must be the 32-character hex API hash from my.telegram.org');
	}

	const updates = {
		...TELEGRAM_LOCAL_MODE_VALUES,
		TELEGRAM_API_CREDENTIAL_PROVIDER: credentialProvider,
		TELEGRAM_API_ID: credentialProvider === 'env' ? apiId.trim() : '',
		TELEGRAM_API_HASH: credentialProvider === 'env' ? apiHash.trim() : '',
	};
	const nextText = updateEnvText(text, updates);
	const changed = changedKeys(text, nextText);

	if (args['dry-run']) {
		console.log(`Dry run for ${envPath}`);
		console.log(
			createdFromExample
				? 'Would create the env file from .env.example.'
				: 'Would update the existing env file.',
		);
		console.log(`Changed keys: ${changed.length > 0 ? changed.join(', ') : 'none'}`);
		if (materialized.changedKeys.length > 0) {
			console.log(
				`Generated local secret keys: ${materialized.changedKeys.join(', ')} (values not printed).`,
			);
		}
		console.log(
			credentialProvider === 'os-keychain'
				? 'Would store Telegram API credentials in macOS Keychain and clear .env.local values.'
				: 'Would store Telegram API credentials in .env.local.',
		);
		console.log('TELEGRAM_API_ID and TELEGRAM_API_HASH values were not printed.');
		return;
	}

	if (credentialProvider === 'os-keychain') {
		await writeTelegramApiCredentialsToKeychain(parseEnvText(nextText), {
			apiHash: apiHash.trim(),
			apiId: apiId.trim(),
		});
	}

	writePrivateEnvFile(envPath, nextText);
	console.log(`${createdFromExample ? 'Created' : 'Updated'} ${envPath}`);
	console.log(`Set ${changed.length} local Telegram safety key(s).`);
	if (materialized.changedKeys.length > 0) {
		console.log(
			`Generated ${materialized.changedKeys.length} random local secret(s): ${materialized.changedKeys.join(', ')}`,
		);
	}
	if (credentialProvider === 'os-keychain') {
		console.log('TELEGRAM_API_ID=[stored in macOS Keychain; not printed]');
		console.log('TELEGRAM_API_HASH=[stored in macOS Keychain; not printed]');
	} else {
		console.log('TELEGRAM_API_ID=[configured in .env.local; not printed]');
		console.log('TELEGRAM_API_HASH=[configured in .env.local; not printed]');
	}
	console.log('AWS KMS variables were cleared for Telegram local Keychain mode.');
	console.log('Next: pnpm telegram:doctor');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

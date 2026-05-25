#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import { writePrivateEnvFile } from './lib/env-file.mjs';
import { materializeLocalRuntimeSecrets } from './lib/local-runtime-safety.mjs';
import {
	OPENAI_LOCAL_MODE_VALUES,
	getOpenAIApiKeyProvider,
	validateOpenAIApiKey,
	writeOpenAIApiKeyToKeychain,
} from './lib/openai-local-mode.mjs';
import {
	DEFAULT_ENV_PATH,
	envValue,
	parseArgs,
	parseEnvText,
	readEnvText,
	updateEnvText,
} from './lib/telegram-local-mode.mjs';

const OPENAI_API_KEY_URL = 'https://platform.openai.com/settings/organization/api-keys';

function printHelp() {
	console.log(`Usage: pnpm openai:setup [options]

Stores a local OpenAI API key for embeddings and semantic knowledge search.

Before running interactively:
  1. Open ${OPENAI_API_KEY_URL}
  2. Create a restricted API key for this local Gordian install.
  3. Paste it into this wizard.

Options:
  --env <path>          Env file to update. Defaults to .env.local.
  --from-env            Read existing OPENAI_API_KEY and migrate it to Keychain.
  --credential-provider <os-keychain|env>
                         Defaults to os-keychain. Use env only for CI or non-macOS tests.
  --dry-run             Print the keys that would change without writing.
  --help                Show this help text.

ChatGPT OAuth is not currently a supported general API credential path for
Gordian. The supported local-user path is an OpenAI API key, preferably stored
in macOS Keychain.

OpenAI API key is accepted only via the hidden interactive prompt or --from-env,
so it is not saved in shell history or process listings.
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
	console.log('OpenAI API credentials');
	console.log(`1. Open ${OPENAI_API_KEY_URL}`);
	console.log('2. Create a restricted API key for this local Gordian install.');
	console.log('3. Paste the key into this wizard.');
	console.log('Keep the key private. Interactive prompts hide it while you type and after saving.');
	console.log(
		'ChatGPT OAuth is not used here; Gordian needs an API credential for server-side embeddings.',
	);
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

	const existingCredentialProvider = getOpenAIApiKeyProvider(env);
	if (existingCredentialProvider === 'invalid') {
		throw new Error('Existing OPENAI_API_KEY_PROVIDER must be os-keychain or env');
	}
	const credentialProvider = String(args['credential-provider'] || 'os-keychain');
	if (credentialProvider !== 'os-keychain' && credentialProvider !== 'env') {
		throw new Error('--credential-provider must be os-keychain or env');
	}
	if (args['api-key']) {
		throw new Error(
			'--api-key is not accepted because it exposes the secret in process arguments. Run interactively or use --from-env.',
		);
	}

	if (!args['from-env']) {
		printCredentialInstructions();
	}

	const apiKey = args['from-env']
		? envValue(env, 'OPENAI_API_KEY')
		: await promptSecret('OpenAI API key', envValue(env, 'OPENAI_API_KEY'));

	if (!validateOpenAIApiKey(apiKey)) {
		throw new Error('OPENAI_API_KEY must look like an OpenAI API key starting with sk-');
	}

	const updates = {
		...OPENAI_LOCAL_MODE_VALUES,
		OPENAI_API_KEY_PROVIDER: credentialProvider,
		OPENAI_API_KEY: credentialProvider === 'env' ? apiKey.trim() : '',
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
				? 'Would store OpenAI API key in macOS Keychain and clear OPENAI_API_KEY in .env.local.'
				: 'Would store OpenAI API key in .env.local.',
		);
		console.log('OPENAI_API_KEY value was not printed.');
		return;
	}

	if (credentialProvider === 'os-keychain') {
		await writeOpenAIApiKeyToKeychain(parseEnvText(nextText), apiKey);
	}

	writePrivateEnvFile(envPath, nextText);
	console.log(`${createdFromExample ? 'Created' : 'Updated'} ${envPath}`);
	console.log(`Set ${changed.length} local OpenAI key setting(s).`);
	if (materialized.changedKeys.length > 0) {
		console.log(
			`Generated ${materialized.changedKeys.length} random local secret(s): ${materialized.changedKeys.join(', ')}`,
		);
	}
	if (credentialProvider === 'os-keychain') {
		console.log('OPENAI_API_KEY=[stored in macOS Keychain; not printed]');
	} else {
		console.log('OPENAI_API_KEY=[configured in .env.local; not printed]');
	}
	console.log('Next: restart the web and worker processes so they read the updated provider.');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

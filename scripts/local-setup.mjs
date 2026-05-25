#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { writePrivateEnvFile } from './lib/env-file.mjs';
import { materializeLocalRuntimeSecrets } from './lib/local-runtime-safety.mjs';
import { DEFAULT_ENV_PATH, parseArgs, readEnvText } from './lib/telegram-local-mode.mjs';

function printHelp() {
	console.log(`Usage: pnpm setup:local [options]

Creates or updates the local env file with random local-only internal secrets.

Options:
  --env <path>   Env file to update. Defaults to .env.local.
  --dry-run      Show which secret keys would be generated without writing.
  --help         Show this help text.
`);
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

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const { createdFromExample, text } = loadBaseEnvText(envPath);
	const materialized = materializeLocalRuntimeSecrets(text);

	if (args['dry-run']) {
		console.log(`Dry run for ${envPath}`);
		console.log(
			createdFromExample ? 'Would create env file from .env.example.' : 'Would update env file.',
		);
		console.log(
			`Generated local secret keys: ${
				materialized.changedKeys.length > 0 ? materialized.changedKeys.join(', ') : 'none'
			}`,
		);
		console.log('Secret values were not printed.');
		return;
	}

	writePrivateEnvFile(envPath, materialized.text);
	console.log(`${createdFromExample ? 'Created' : 'Updated'} ${envPath}`);
	console.log(
		`Generated ${materialized.changedKeys.length} random local secret(s): ${
			materialized.changedKeys.length > 0 ? materialized.changedKeys.join(', ') : 'none'
		}`,
	);
	console.log('Secret values were not printed. Next: pnpm demo:setup');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

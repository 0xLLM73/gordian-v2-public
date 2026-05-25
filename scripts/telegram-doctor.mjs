#!/usr/bin/env node

import {
	DEFAULT_ENV_PATH,
	canConnectTcp,
	classifyDoctor,
	endpointFromUrl,
	envValue,
	getTelegramApiCredentialProvider,
	parseArgs,
	parseEnvText,
	probeMacOsKeychain,
	readEnvText,
	readTelegramApiCredentialsFromKeychain,
	validateTelegramApiHash,
	validateTelegramApiId,
} from './lib/telegram-local-mode.mjs';

function printHelp() {
	console.log(`Usage: pnpm telegram:doctor [options]

Checks whether local Telegram personal-account mode is configured safely.

Options:
  --env <path>                 Env file to inspect. Defaults to .env.local.
  --allow-missing-credentials  Warn instead of failing when TELEGRAM_API_ID/HASH are blank.
  --skip-keychain              Skip the macOS Keychain write/read probe.
  --skip-network               Skip local Postgres/Redis TCP probes.
  --help                       Show this help text.
`);
}

function printChecks(checks) {
	for (const check of checks) {
		const label = check.level.toUpperCase().padEnd(4, ' ');
		console.log(`${label} ${check.name}: ${check.detail}`);
	}
}

async function addNetworkChecks(checks, env) {
	const targets = [
		{
			fallbackPort: 5432,
			name: 'Postgres TCP',
			url: envValue(env, 'DATABASE_URL'),
		},
		{
			fallbackPort: 6379,
			name: 'Redis TCP',
			url: envValue(env, 'DRAGONFLY_URL') || envValue(env, 'REDIS_URL'),
		},
	];

	for (const target of targets) {
		try {
			const endpoint = endpointFromUrl(target.url, target.fallbackPort);
			const reachable = await canConnectTcp(endpoint.host, endpoint.port);
			checks.push({
				detail: reachable
					? `reachable at ${endpoint.host}:${endpoint.port}`
					: `not reachable at ${endpoint.host}:${endpoint.port}`,
				level: reachable ? 'pass' : 'fail',
				name: target.name,
			});
		} catch {
			checks.push({
				detail: 'could not parse local endpoint URL',
				level: 'fail',
				name: target.name,
			});
		}
	}
}

async function addTelegramApiCredentialChecks(checks, env, options = {}) {
	if (options.allowMissingCredentials) {
		checks.push({
			detail: 'credential presence check skipped',
			level: 'warn',
			name: 'Telegram API credentials',
		});
		return;
	}

	const provider = getTelegramApiCredentialProvider(env);
	if (provider === 'invalid') {
		checks.push({
			detail: 'expected os-keychain or env',
			level: 'fail',
			name: 'TELEGRAM_API_CREDENTIAL_PROVIDER',
		});
		return;
	}

	if (provider === 'os-keychain') {
		if (envValue(env, 'TELEGRAM_API_ID') || envValue(env, 'TELEGRAM_API_HASH')) {
			checks.push({
				detail: 'clear TELEGRAM_API_ID/HASH from .env.local when using os-keychain',
				level: 'fail',
				name: 'Telegram API env residue',
			});
		}

		try {
			const credentials = await readTelegramApiCredentialsFromKeychain(env);
			checks.push({
				detail: validateTelegramApiId(credentials.apiId)
					? 'stored in macOS Keychain and numeric'
					: 'stored API ID is missing or invalid',
				level: validateTelegramApiId(credentials.apiId) ? 'pass' : 'fail',
				name: 'TELEGRAM_API_ID',
			});
			checks.push({
				detail: validateTelegramApiHash(credentials.apiHash)
					? 'stored in macOS Keychain and shaped like a Telegram API hash'
					: 'stored API hash is missing or invalid',
				level: validateTelegramApiHash(credentials.apiHash) ? 'pass' : 'fail',
				name: 'TELEGRAM_API_HASH',
			});
		} catch (error) {
			checks.push({
				detail: error instanceof Error ? error.message : String(error),
				level: 'fail',
				name: 'Telegram API Keychain',
			});
		}
		return;
	}

	checks.push({
		detail:
			'env mode leaves Telegram API credentials in .env.local; use os-keychain for normal macOS users',
		level: 'warn',
		name: 'TELEGRAM_API_CREDENTIAL_PROVIDER',
	});
	checks.push({
		detail: validateTelegramApiId(envValue(env, 'TELEGRAM_API_ID'))
			? 'present and numeric'
			: 'missing or invalid',
		level: validateTelegramApiId(envValue(env, 'TELEGRAM_API_ID')) ? 'pass' : 'fail',
		name: 'TELEGRAM_API_ID',
	});
	checks.push({
		detail: validateTelegramApiHash(envValue(env, 'TELEGRAM_API_HASH'))
			? 'present and shaped like a Telegram API hash'
			: 'missing or invalid',
		level: validateTelegramApiHash(envValue(env, 'TELEGRAM_API_HASH')) ? 'pass' : 'fail',
		name: 'TELEGRAM_API_HASH',
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const envPath = args.env || DEFAULT_ENV_PATH;
	const text = readEnvText(envPath);
	if (!text) {
		console.error(`FAIL .env file: ${envPath} does not exist or is empty`);
		process.exitCode = 1;
		return;
	}

	const env = parseEnvText(text);
	const checks = classifyDoctor(env, {
		allowMissingCredentials: Boolean(args['allow-missing-credentials']),
		skipCredentialChecks: true,
	});

	await addTelegramApiCredentialChecks(checks, env, {
		allowMissingCredentials: Boolean(args['allow-missing-credentials']),
	});

	if (!args['skip-keychain']) {
		const service = envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') || 'gordian-v2';
		const requireUserPresence = envValue(env, 'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE') === 'true';
		try {
			if (requireUserPresence) {
				throw new Error(
					'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE=true is not supported in the CLI flow; keep it false or use AWS KMS/signed native packaging.',
				);
			}
			await probeMacOsKeychain(service);
			checks.push({
				detail: `write/read/delete probe passed for service ${service}`,
				level: 'pass',
				name: 'macOS Keychain',
			});
		} catch (error) {
			checks.push({
				detail: error instanceof Error ? error.message : String(error),
				level: 'fail',
				name: 'macOS Keychain',
			});
		}
	}

	if (!args['skip-network']) {
		await addNetworkChecks(checks, env);
	}

	console.log(`Telegram local safety doctor (${envPath})`);
	printChecks(checks);

	const failures = checks.filter((check) => check.level === 'fail').length;
	const warnings = checks.filter((check) => check.level === 'warn').length;
	console.log(`Summary: ${failures} failure(s), ${warnings} warning(s)`);

	if (failures > 0) {
		console.log('Fix failures before connecting a personal Telegram account.');
		process.exitCode = 1;
	} else {
		console.log('Local Telegram personal-account mode is configured for a guarded read-only test.');
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

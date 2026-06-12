#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
	ALLOW_NONLOCAL_DEMO_TARGETS_ENV,
	assertLocalDemoTargets,
	GRAMMY_SESSION_KEY_PREFIX,
	isLegacyGrammySessionEntry,
	LOCAL_REDIS_PURGE_PATTERNS,
	LOCAL_RUNTIME_SECRET_KEYS,
	materializeLocalRuntimeSecrets,
} from './lib/local-runtime-safety.mjs';
import { parseEnvText } from './lib/telegram-local-mode.mjs';

function expectThrows(message, fn) {
	let threw = false;
	try {
		fn();
	} catch (error) {
		threw = true;
		assert.match(error instanceof Error ? error.message : String(error), message);
	}
	assert.equal(threw, true, `expected ${message} to throw`);
}

const sampleEnv = `
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/gordian_dev"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/gordian_dev"
DRAGONFLY_URL="redis://[::1]:6379"
BETTER_AUTH_SECRET="dev-secret-min-32-chars-long-enough-for-signing"
INTERNAL_AUTH_SECRET="dev-internal-secret-min-32-chars-long-enough"
WORKER_INTERNAL_SECRET=""
OAUTH_STATE_SECRET=""
`;

const materialized = materializeLocalRuntimeSecrets(sampleEnv);
const env = parseEnvText(materialized.text);
assert.deepEqual([...materialized.changedKeys].sort(), [...LOCAL_RUNTIME_SECRET_KEYS].sort());

const generatedSecrets = LOCAL_RUNTIME_SECRET_KEYS.map((key) => env.get(key));
for (const value of generatedSecrets) {
	assert.equal(typeof value, 'string');
	assert.ok(value.length >= 32);
	assert.doesNotMatch(value, /^dev-/);
}
assert.equal(new Set(generatedSecrets).size, generatedSecrets.length);

assert.doesNotThrow(() =>
	assertLocalDemoTargets({
		DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/gordian_dev',
		DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/gordian_dev',
		DRAGONFLY_URL: 'redis://[::1]:6379',
		NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
		WORKER_URL: 'http://127.0.0.1:3001',
		WEB_URL: 'http://localhost:3000',
		CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
	}),
);

expectThrows(/refuses nonlocal DATABASE_URL/, () =>
	assertLocalDemoTargets({
		DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/gordian_dev',
		DRAGONFLY_URL: 'redis://localhost:6379',
	}),
);
expectThrows(/refuses nonlocal REDIS_URL/, () =>
	assertLocalDemoTargets({
		DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/gordian_dev',
		REDIS_URL: 'redis://redis.example.com:6379',
	}),
);
expectThrows(/refuses nonlocal NEXT_PUBLIC_APP_URL/, () =>
	assertLocalDemoTargets({
		DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/gordian_dev',
		REDIS_URL: 'redis://localhost:6379',
		NEXT_PUBLIC_APP_URL: 'https://gordian.example.com',
	}),
);
expectThrows(/refuses nonlocal CORS_ORIGIN/, () =>
	assertLocalDemoTargets({
		DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/gordian_dev',
		REDIS_URL: 'redis://localhost:6379',
		CORS_ORIGIN: 'http://localhost:3000,https://gordian.example.com',
	}),
);
assert.doesNotThrow(() =>
	assertLocalDemoTargets({
		[ALLOW_NONLOCAL_DEMO_TARGETS_ENV]: 'true',
		DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/gordian_dev',
		REDIS_URL: 'redis://redis.example.com:6379',
		NEXT_PUBLIC_APP_URL: 'https://gordian.example.com',
		CORS_ORIGIN: 'https://gordian.example.com',
	}),
);

const compose = readFileSync('docker-compose.yml', 'utf8');
assert.match(compose, /"127\.0\.0\.1:5432:5432"/);
assert.match(compose, /"127\.0\.0\.1:6379:6379"/);
assert.match(compose, /"--protected-mode"/);
assert.match(compose, /--auth-host=scram-sha-256/);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert.match(packageJson.scripts['demo:setup'], /demo:guard/);
assert.equal(packageJson.scripts['setup:local'], 'node scripts/local-setup.mjs');

for (const pattern of [
	'auth:phone:*',
	'rate:send-code:*',
	'rate:verify-code:*',
	'tg:send:*',
	'telegram:session:lock:*',
	'telegram:session:blocked:*',
	'{ai-flow}:*',
	'bull:*',
	`${GRAMMY_SESSION_KEY_PREFIX}*`,
	'grammy:*',
	'session:*',
]) {
	assert.ok(LOCAL_REDIS_PURGE_PATTERNS.includes(pattern), `${pattern} is covered by purge`);
}

assert.equal(
	isLegacyGrammySessionEntry(
		'123456',
		'{"step":"onboarding_phone","data":{"phone":"+15551234567"}}',
	),
	true,
);
assert.equal(isLegacyGrammySessionEntry('-1001234567890', '{"step":"idle"}'), true);
assert.equal(isLegacyGrammySessionEntry('123456', '{"step":"not_this_bot"}'), false);
assert.equal(isLegacyGrammySessionEntry('user:123456', '{"step":"idle"}'), false);

const checkDbDefault = spawnSync(process.execPath, ['scripts/check-db.mjs'], {
	encoding: 'utf8',
	env: { ...process.env, ALLOW_SENSITIVE_DB_INSPECTION: '', DATABASE_URL: '' },
	stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(checkDbDefault.status, 1);
assert.match(checkDbDefault.stderr, /Refusing privileged DB inspection/);

console.log('Local runtime safety smoke passed.');

import { randomBytes } from 'node:crypto';
import { envValue, parseEnvText, updateEnvText } from './telegram-local-mode.mjs';

export const ALLOW_NONLOCAL_DEMO_TARGETS_ENV = 'ALLOW_NONLOCAL_DEMO_TARGETS';
export const ALLOW_NONLOCAL_PURGE_TARGETS_ENV = 'ALLOW_NONLOCAL_RUNTIME_PURGE';

export const LOCAL_RUNTIME_SECRET_KEYS = [
	'BETTER_AUTH_SECRET',
	'INTERNAL_AUTH_SECRET',
	'WORKER_INTERNAL_SECRET',
	'PHONE_REDIS_KEY_SECRET',
	'ADMIN_AI_REPROCESS_CONFIRM_SECRET',
	'OAUTH_STATE_SECRET',
];

export const GRAMMY_SESSION_KEY_PREFIX = 'grammy:session:';

const GRAMMY_SESSION_STEPS = new Set([
	'idle',
	'onboarding_name',
	'onboarding_phone',
	'onboarding_confirm',
	'deal_title',
	'deal_value',
	'deal_contact',
	'brief_request',
	'summary_select',
]);

const SAMPLE_LOCAL_SECRETS = new Set([
	'dev-secret-min-32-chars-long-enough-for-signing',
	'dev-internal-secret-min-32-chars-long-enough',
	'dev-worker-secret-min-32-chars-long-enough',
	'dev-auth-secret-min-32-chars-long',
	'dev-secret-min-32-chars-long-enough',
]);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const LOCAL_REDIS_PURGE_PATTERNS = [
	'auth:phone:*',
	'tg:send:*',
	'telegram:session:lock:*',
	'telegram:session:blocked:*',
	'telegram:session:*',
	'{ai-flow}:*',
	'bull:*',
	`${GRAMMY_SESSION_KEY_PREFIX}*`,
	'grammy:*',
	'session:*',
	'sessions:*',
];

export function isLegacyGrammySessionEntry(key, value) {
	if (!/^-?\d+$/.test(String(key ?? ''))) return false;
	if (typeof value !== 'string' || value.trim().length === 0) return false;

	try {
		const parsed = JSON.parse(value);
		return (
			parsed !== null &&
			typeof parsed === 'object' &&
			typeof parsed.step === 'string' &&
			GRAMMY_SESSION_STEPS.has(parsed.step)
		);
	} catch {
		return false;
	}
}

function envLookup(env, key) {
	if (env instanceof Map) return envValue(env, key);
	return String(env?.[key] ?? '').trim();
}

function isOverrideEnabled(env, key) {
	return envLookup(env, key) === 'true';
}

export function generateLocalSecret() {
	return randomBytes(32).toString('base64url');
}

export function isPlaceholderLocalSecret(value) {
	const trimmed = String(value ?? '').trim();
	return trimmed.length === 0 || SAMPLE_LOCAL_SECRETS.has(trimmed);
}

export function materializeLocalRuntimeSecrets(text) {
	const env = parseEnvText(text);
	const updates = {};

	for (const key of LOCAL_RUNTIME_SECRET_KEYS) {
		const current = envValue(env, key);
		if (isPlaceholderLocalSecret(current)) {
			updates[key] = generateLocalSecret();
		}
	}

	if (Object.keys(updates).length === 0) {
		return { changedKeys: [], text };
	}

	return {
		changedKeys: Object.keys(updates),
		text: updateEnvText(text, updates),
	};
}

export function isLocalServiceUrl(value) {
	if (!value) return false;
	try {
		const parsed = new URL(value);
		return LOCAL_HOSTS.has(parsed.hostname.replace(/^\[|\]$/g, ''));
	} catch {
		return false;
	}
}

export function isLocalServiceUrlList(value) {
	if (!value) return false;
	return String(value)
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.every((entry) => isLocalServiceUrl(entry));
}

export function assertLocalServiceUrl({ env, key, label, required = true, overrideEnv }) {
	const value = envLookup(env, key);
	if (!value) {
		if (!required) return;
		throw new Error(`${label} requires ${key} to be set`);
	}

	if (isLocalServiceUrl(value) || (overrideEnv && isOverrideEnabled(env, overrideEnv))) {
		return;
	}

	throw new Error(
		`${label} refuses nonlocal ${key} (${redactUrl(value)}). Set ${overrideEnv}=true only if you intentionally want this command to touch a remote service.`,
	);
}

export function assertLocalDemoTargets(env) {
	for (const key of ['NEXT_PUBLIC_APP_URL', 'BETTER_AUTH_URL', 'WEB_URL', 'WORKER_URL']) {
		assertLocalServiceUrl({
			env,
			key,
			label: 'Local demo setup',
			required: false,
			overrideEnv: ALLOW_NONLOCAL_DEMO_TARGETS_ENV,
		});
	}

	const corsOrigin = envLookup(env, 'CORS_ORIGIN');
	if (
		corsOrigin &&
		!isLocalServiceUrlList(corsOrigin) &&
		!isOverrideEnabled(env, ALLOW_NONLOCAL_DEMO_TARGETS_ENV)
	) {
		throw new Error(
			`Local demo setup refuses nonlocal CORS_ORIGIN (${corsOrigin}). Set ${ALLOW_NONLOCAL_DEMO_TARGETS_ENV}=true only if you intentionally want this command to trust a remote browser origin.`,
		);
	}

	assertLocalServiceUrl({
		env,
		key: 'DATABASE_URL',
		label: 'Local demo setup',
		overrideEnv: ALLOW_NONLOCAL_DEMO_TARGETS_ENV,
	});
	assertLocalServiceUrl({
		env,
		key: 'DIRECT_URL',
		label: 'Local demo setup',
		required: false,
		overrideEnv: ALLOW_NONLOCAL_DEMO_TARGETS_ENV,
	});

	const redisKey = envLookup(env, 'DRAGONFLY_URL') ? 'DRAGONFLY_URL' : 'REDIS_URL';
	assertLocalServiceUrl({
		env,
		key: redisKey,
		label: 'Local demo setup',
		overrideEnv: ALLOW_NONLOCAL_DEMO_TARGETS_ENV,
	});
}

export function assertLocalPurgeTargets(env) {
	assertLocalServiceUrl({
		env,
		key: 'DATABASE_URL',
		label: 'Runtime purge',
		overrideEnv: ALLOW_NONLOCAL_PURGE_TARGETS_ENV,
	});

	const redisKey = envLookup(env, 'DRAGONFLY_URL') ? 'DRAGONFLY_URL' : 'REDIS_URL';
	assertLocalServiceUrl({
		env,
		key: redisKey,
		label: 'Runtime purge',
		required: false,
		overrideEnv: ALLOW_NONLOCAL_PURGE_TARGETS_ENV,
	});
}

export function redactUrl(value) {
	try {
		const parsed = new URL(value);
		if (parsed.password) parsed.password = '[redacted]';
		if (parsed.username) parsed.username = '[redacted]';
		return parsed.toString();
	} catch {
		return '[invalid-url]';
	}
}

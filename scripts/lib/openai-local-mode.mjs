import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeKeychainSecret } from './keychain-secret-writer.mjs';
import { DEFAULT_KEYCHAIN_SERVICE, envValue } from './telegram-local-mode.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_OPENAI_API_KEYCHAIN_ACCOUNT = 'openai-api-key';
export const OPENAI_LOCAL_MODE_VALUES = {
	OPENAI_API_KEY_PROVIDER: 'os-keychain',
	OPENAI_KEYCHAIN_SERVICE: DEFAULT_KEYCHAIN_SERVICE,
	OPENAI_API_KEYCHAIN_ACCOUNT: DEFAULT_OPENAI_API_KEYCHAIN_ACCOUNT,
	OPENAI_API_KEY: '',
};

export function validateOpenAIApiKey(value) {
	return /^sk-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export function getOpenAIApiKeyProvider(env) {
	const configured = envValue(env, 'OPENAI_API_KEY_PROVIDER');
	if (!configured) return 'env';
	if (configured === 'env' || configured === 'os-keychain') return configured;
	return 'invalid';
}

export function getOpenAIKeychainService(env) {
	return (
		envValue(env, 'OPENAI_KEYCHAIN_SERVICE') ||
		envValue(env, 'TELEGRAM_KEYCHAIN_SERVICE') ||
		DEFAULT_KEYCHAIN_SERVICE
	);
}

export function getOpenAIApiKeychainAccount(env) {
	return envValue(env, 'OPENAI_API_KEYCHAIN_ACCOUNT') || DEFAULT_OPENAI_API_KEYCHAIN_ACCOUNT;
}

export async function writeOpenAIApiKeyToKeychain(env, apiKey) {
	if (process.platform !== 'darwin') {
		throw new Error('macOS Keychain is required for OPENAI_API_KEY_PROVIDER=os-keychain');
	}

	await writeKeychainSecret({
		account: getOpenAIApiKeychainAccount(env),
		service: getOpenAIKeychainService(env),
		secret: apiKey.trim(),
	});
}

export async function readOpenAIApiKeyFromKeychain(env) {
	if (process.platform !== 'darwin') {
		throw new Error('macOS Keychain is required for OPENAI_API_KEY_PROVIDER=os-keychain');
	}

	const result = await execFileAsync('security', [
		'find-generic-password',
		'-a',
		getOpenAIApiKeychainAccount(env),
		'-s',
		getOpenAIKeychainService(env),
		'-w',
	]);
	const stdout =
		typeof result === 'object' && result !== null && 'stdout' in result ? result.stdout : result;
	return String(stdout).trim();
}

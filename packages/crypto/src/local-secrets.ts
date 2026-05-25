import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type OpenAIApiKeyProvider = 'env' | 'os-keychain';

const DEFAULT_KEYCHAIN_SERVICE = 'gordian-v2';
const DEFAULT_OPENAI_API_KEYCHAIN_ACCOUNT = 'openai-api-key';

function getOpenAIKeychainService(): string {
	return (
		process.env.OPENAI_KEYCHAIN_SERVICE?.trim() ||
		process.env.TELEGRAM_KEYCHAIN_SERVICE?.trim() ||
		DEFAULT_KEYCHAIN_SERVICE
	);
}

function getOpenAIKeychainAccount(): string {
	return process.env.OPENAI_API_KEYCHAIN_ACCOUNT?.trim() || DEFAULT_OPENAI_API_KEYCHAIN_ACCOUNT;
}

function ensureMacOsKeychainAvailable(): void {
	if (process.platform !== 'darwin') {
		throw new Error(
			'OPENAI_API_KEY_PROVIDER=os-keychain requires macOS Keychain. Use OPENAI_API_KEY_PROVIDER=env for CI or non-macOS local runs.',
		);
	}
}

export function getOpenAIApiKeyProvider(): OpenAIApiKeyProvider {
	const configured = process.env.OPENAI_API_KEY_PROVIDER?.trim();
	if (!configured) return 'env';
	if (configured === 'env' || configured === 'os-keychain') return configured;
	throw new Error(`Invalid OPENAI_API_KEY_PROVIDER="${configured}". Expected env or os-keychain.`);
}

async function readOpenAIKeyFromKeychain(): Promise<string | undefined> {
	ensureMacOsKeychainAvailable();

	const result = (await execFileAsync('security', [
		'find-generic-password',
		'-a',
		getOpenAIKeychainAccount(),
		'-s',
		getOpenAIKeychainService(),
		'-w',
	])) as unknown;
	const stdout =
		typeof result === 'object' && result !== null && 'stdout' in result
			? (result as { stdout: unknown }).stdout
			: result;

	const apiKey = String(stdout).trim();
	return apiKey.length > 0 ? apiKey : undefined;
}

/**
 * Resolve the local OpenAI API key without exposing it to browser code.
 *
 * Normal local users should prefer OPENAI_API_KEY_PROVIDER=os-keychain via
 * `pnpm openai:setup`, which keeps the key out of `.env.local` and shell
 * history. CI and non-macOS environments can keep using OPENAI_API_KEY.
 */
export async function getOpenAIApiKey(): Promise<string | undefined> {
	const provider = getOpenAIApiKeyProvider();
	if (provider === 'env') {
		const apiKey = process.env.OPENAI_API_KEY?.trim();
		return apiKey && apiKey.length > 0 ? apiKey : undefined;
	}

	return readOpenAIKeyFromKeychain();
}

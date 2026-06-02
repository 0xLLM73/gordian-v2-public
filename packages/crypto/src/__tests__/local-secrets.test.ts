import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SecurityCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
	execFile: execFileMock,
}));

function argValue(args: string[], flag: string): string {
	const index = args.indexOf(flag);
	if (index === -1 || !args[index + 1]) throw new Error(`Missing ${flag}`);
	return args[index + 1];
}

describe('OpenAI local API key provider', () => {
	let originalPlatform: PropertyDescriptor | undefined;

	beforeEach(() => {
		vi.resetModules();
		execFileMock.mockReset();
		Reflect.deleteProperty(process.env, 'OPENAI_API_KEY');
		Reflect.deleteProperty(process.env, 'OPENAI_API_KEY_PROVIDER');
		Reflect.deleteProperty(process.env, 'OPENAI_API_KEYCHAIN_ACCOUNT');
		Reflect.deleteProperty(process.env, 'OPENAI_KEYCHAIN_SERVICE');
		Reflect.deleteProperty(process.env, 'TELEGRAM_KEYCHAIN_SERVICE');
	});

	afterEach(() => {
		if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
	});

	it('defaults to env provider and returns an env API key', async () => {
		process.env.OPENAI_API_KEY = 'sk-test-local-secret';

		const { getOpenAIApiKey, getOpenAIApiKeyProvider } = await import('../local-secrets');

		expect(getOpenAIApiKeyProvider()).toBe('env');
		await expect(getOpenAIApiKey()).resolves.toBe('sk-test-local-secret');
		expect(execFileMock).not.toHaveBeenCalled();
	});

	it('returns undefined for blank env API keys', async () => {
		process.env.OPENAI_API_KEY = '   ';

		const { getOpenAIApiKey } = await import('../local-secrets');

		await expect(getOpenAIApiKey()).resolves.toBeUndefined();
	});

	it('rejects unknown provider names', async () => {
		process.env.OPENAI_API_KEY_PROVIDER = 'chatgpt-oauth';

		const { getOpenAIApiKeyProvider } = await import('../local-secrets');

		expect(() => getOpenAIApiKeyProvider()).toThrow(/Invalid OPENAI_API_KEY_PROVIDER/);
	});

	it('reads the API key from macOS Keychain when configured', async () => {
		process.env.OPENAI_API_KEY_PROVIDER = 'os-keychain';
		process.env.OPENAI_API_KEYCHAIN_ACCOUNT = 'openai-test-account';
		process.env.OPENAI_KEYCHAIN_SERVICE = 'gordian-test';

		originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
		Object.defineProperty(process, 'platform', {
			configurable: true,
			enumerable: true,
			value: 'darwin',
		});

		execFileMock.mockImplementation(
			(command: string, args: string[], callback: SecurityCallback) => {
				expect(command).toBe('security');
				expect(args[0]).toBe('find-generic-password');
				expect(argValue(args, '-a')).toBe('openai-test-account');
				expect(argValue(args, '-s')).toBe('gordian-test');
				callback(null, 'sk-keychain-secret\n', '');
			},
		);

		const { getOpenAIApiKey, getOpenAIApiKeyProvider } = await import('../local-secrets');

		expect(getOpenAIApiKeyProvider()).toBe('os-keychain');
		await expect(getOpenAIApiKey()).resolves.toBe('sk-keychain-secret');
	});

	it('rejects os-keychain provider outside macOS', async () => {
		process.env.OPENAI_API_KEY_PROVIDER = 'os-keychain';

		originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
		Object.defineProperty(process, 'platform', {
			configurable: true,
			enumerable: true,
			value: 'linux',
		});

		const { getOpenAIApiKey } = await import('../local-secrets');

		await expect(getOpenAIApiKey()).rejects.toThrow(/requires macOS Keychain/);
	});
});

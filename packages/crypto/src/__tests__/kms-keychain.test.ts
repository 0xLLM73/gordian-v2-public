import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SecurityCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
	execFile: execFileMock,
	spawn: spawnMock,
}));

function argValue(args: string[], flag: string): string {
	const index = args.indexOf(flag);
	if (index === -1 || !args[index + 1]) throw new Error(`Missing ${flag}`);
	return args[index + 1];
}

const keychain = new Map<string, string>();
let originalPlatform: PropertyDescriptor | undefined;

function helperPath(args: string[]): string {
	return args[2] ?? '';
}

function keychainGetCalls() {
	return spawnMock.mock.calls.filter(
		([command, args]) =>
			command === 'swift' &&
			Array.isArray(args) &&
			helperPath(args).endsWith('keychain-get-secret.swift'),
	);
}

beforeEach(() => {
	vi.resetModules();
	keychain.clear();
	execFileMock.mockReset();
	spawnMock.mockReset();
	Reflect.deleteProperty(process.env, 'DEV_KMS_BYPASS');
	Reflect.deleteProperty(process.env, 'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE');
	Reflect.deleteProperty(process.env, 'GORDIAN_KEYCHAIN_SERVICE');
	Reflect.deleteProperty(process.env, 'WORKSPACE_KEY_CACHE_TTL_MINUTES');
	process.env.NODE_ENV = 'test';
	process.env.TELEGRAM_SESSION_KEY_PROVIDER = 'os-keychain';
	process.env.TELEGRAM_KEYCHAIN_SERVICE = 'gordian-test';
	process.env.WORKSPACE_KEY_PROVIDER = 'os-keychain';
	process.env.WORKSPACE_KEYCHAIN_SERVICE = 'gordian-workspace-test';

	originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', {
		configurable: true,
		enumerable: true,
		value: 'darwin',
	});

	spawnMock.mockImplementation((command: string, args: string[]) => {
		if (command !== 'swift') throw new Error(`Unexpected command ${command}`);
		const service = args[3];
		const account = args[4];
		const mode = args[5];
		if (!service || !account || !mode) throw new Error('Missing keychain helper arguments');
		const isGetHelper = helperPath(args).endsWith('keychain-get-secret.swift');
		const listeners = new Map<string, (...eventArgs: unknown[]) => void>();
		const stdoutListeners = new Map<string, (chunk: string) => void>();
		const stderrListeners = new Map<string, (chunk: string) => void>();
		const stdout = {
			setEncoding: vi.fn(),
			on: vi.fn((event: string, callback: (chunk: string) => void) => {
				stdoutListeners.set(event, callback);
			}),
		};
		const stderr = {
			setEncoding: vi.fn(),
			on: vi.fn((event: string, callback: (chunk: string) => void) => {
				stderrListeners.set(event, callback);
			}),
		};
		const child = {
			stdout,
			stderr,
			once: vi.fn((event: string, callback: (...eventArgs: unknown[]) => void) => {
				listeners.set(event, callback);
				return child;
			}),
			stdin: {
				end: vi.fn((secret: string) => {
					if (isGetHelper) throw new Error('Get helper should not receive stdin');
					keychain.set(`${service}:${account}`, secret);
					queueMicrotask(() => listeners.get('close')?.(0, null));
				}),
			},
			kill: vi.fn(),
		};
		if (isGetHelper) {
			queueMicrotask(() => {
				const secret = keychain.get(`${service}:${account}`);
				if (!secret) {
					stderrListeners.get('data')?.('Keychain item could not be found');
					listeners.get('close')?.(1, null);
					return;
				}
				stdoutListeners.get('data')?.(`${secret}\n`);
				listeners.get('close')?.(0, null);
			});
		}
		return child;
	});

	execFileMock.mockImplementation(
		(
			command: string,
			args: string[],
			optionsOrCallback: object | SecurityCallback,
			maybeCallback?: SecurityCallback,
		) => {
			const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
			if (!callback) throw new Error('Missing execFile callback');
			if (command !== 'security') {
				callback(new Error(`Unexpected command ${command}`));
				return;
			}

			const account = argValue(args, '-a');
			const service = argValue(args, '-s');
			const key = `${service}:${account}`;
			const action = args[0];

			if (action === 'find-generic-password') {
				const secret = keychain.get(key);
				if (!secret) {
					const error = Object.assign(new Error('could not be found'), {
						code: 44,
						stderr: 'could not be found',
					});
					callback(error, '', 'could not be found');
					return;
				}
				callback(null, `${secret}\n`, '');
				return;
			}

			if (action === 'delete-generic-password') {
				keychain.delete(key);
				callback(null, '', '');
				return;
			}

			callback(new Error(`Unexpected security action ${action}`));
		},
	);
});

afterEach(() => {
	if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
	Reflect.deleteProperty(process.env, 'TELEGRAM_SESSION_KEY_PROVIDER');
	Reflect.deleteProperty(process.env, 'TELEGRAM_KEYCHAIN_SERVICE');
	Reflect.deleteProperty(process.env, 'TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE');
	Reflect.deleteProperty(process.env, 'WORKSPACE_KEY_PROVIDER');
	Reflect.deleteProperty(process.env, 'WORKSPACE_KEYCHAIN_SERVICE');
	Reflect.deleteProperty(process.env, 'WORKSPACE_KEY_CACHE_TTL_MINUTES');
	Reflect.deleteProperty(process.env, 'GORDIAN_KEYCHAIN_SERVICE');
});

describe('OS keychain Telegram session KEK provider', () => {
	it('stores only a keychain marker in the session KEK blob', async () => {
		const { decryptSessionKek, deleteSessionKek, generateSessionKek } = await import('../kms');

		const { plaintext, ciphertextBlob } = await generateSessionKek('user-keychain');
		const marker = ciphertextBlob.toString('utf8');

		expect(ciphertextBlob.equals(plaintext)).toBe(false);
		expect(marker).toContain('gordian:keychain:telegram-session-kek:v1:');
		expect(marker).toContain('gordian-test');
		expect(marker).toContain('telegram-session:user-keychain:');
		expect(marker).not.toContain(plaintext.toString('base64'));

		const parsed = JSON.parse(
			marker.slice('gordian:keychain:telegram-session-kek:v1:'.length),
		) as Record<string, unknown>;
		expect(Object.keys(parsed).sort()).toEqual(['account', 'provider', 'service', 'version']);
		expect(JSON.stringify(parsed)).not.toContain(plaintext.toString('base64'));
		expect(execFileMock).not.toHaveBeenCalledWith(
			'security',
			expect.arrayContaining(['add-generic-password']),
			expect.any(Function),
		);
		expect(spawnMock).toHaveBeenCalledWith(
			'swift',
			expect.not.arrayContaining([plaintext.toString('base64')]),
			expect.any(Object),
		);

		const recovered = await decryptSessionKek(ciphertextBlob, 'user-keychain');
		expect(recovered.equals(plaintext)).toBe(true);
		expect(keychainGetCalls()).toHaveLength(1);

		await deleteSessionKek('user-keychain', ciphertextBlob);
		await expect(decryptSessionKek(ciphertextBlob, 'user-keychain')).rejects.toThrow(
			/Keychain item could not be found/,
		);
	});

	it('refuses to decrypt a keychain marker for the wrong user', async () => {
		const { decryptSessionKek, generateSessionKek } = await import('../kms');

		const { ciphertextBlob } = await generateSessionKek('user-a');

		await expect(decryptSessionKek(ciphertextBlob, 'user-b')).rejects.toThrow(
			/Invalid Telegram session OS keychain marker/,
		);
	});

	it('uses a unique keychain item per generated KEK', async () => {
		const { generateSessionKek } = await import('../kms');

		const first = await generateSessionKek('user-keychain');
		const second = await generateSessionKek('user-keychain');

		const firstMarker = first.ciphertextBlob.toString('utf8');
		const secondMarker = second.ciphertextBlob.toString('utf8');

		expect(firstMarker).not.toBe(secondMarker);
		expect(firstMarker).toContain('telegram-session:user-keychain:');
		expect(secondMarker).toContain('telegram-session:user-keychain:');
		expect(keychain.size).toBe(2);
	});

	it('passes user-presence mode to Telegram session keychain helpers', async () => {
		process.env.TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE = 'true';
		const { decryptSessionKek, generateSessionKek } = await import('../kms');

		const { ciphertextBlob } = await generateSessionKek('user-presence');
		expect(spawnMock).toHaveBeenCalledWith(
			'swift',
			expect.arrayContaining(['require-user-presence']),
			expect.any(Object),
		);

		await decryptSessionKek(ciphertextBlob, 'user-presence');
		expect(keychainGetCalls()[0]?.[1]).toEqual(expect.arrayContaining(['require-user-presence']));
	});
});

describe('OS keychain workspace WRK provider', () => {
	it('stores only a keychain marker in the workspace WRK blob', async () => {
		const { generateWorkspaceWrk, isWorkspaceKeychainMarker, unwrapWrk } = await import('../kms');

		const workspaceId = 'workspace-keychain';
		const { encryptedWrk, kmsContext } = await generateWorkspaceWrk(workspaceId);
		const marker = encryptedWrk.toString('utf8');

		expect(isWorkspaceKeychainMarker(encryptedWrk)).toBe(true);
		expect(marker).toContain('gordian:keychain:workspace-wrk:v1:');
		expect(marker).toContain('gordian-workspace-test');
		expect(marker).toContain('workspace-wrk:workspace-keychain:');
		expect(encryptedWrk.length).toBeGreaterThan(32);

		const parsed = JSON.parse(marker.slice('gordian:keychain:workspace-wrk:v1:'.length)) as {
			account: string;
			service: string;
		};
		const storedSecret = keychain.get(`${parsed.service}:${parsed.account}`);
		expect(storedSecret).toBeDefined();
		expect(marker).not.toContain(String(storedSecret));
		expect(JSON.stringify(kmsContext)).not.toContain(String(storedSecret));

		const recovered = await unwrapWrk({ encryptedWrk, kmsContext, wrkVersion: 1 });
		expect(recovered.length).toBe(32);
		expect(recovered.equals(Buffer.from(storedSecret ?? '', 'base64'))).toBe(true);
	});

	it('deletes the workspace Keychain item referenced by the marker', async () => {
		const { deleteWorkspaceWrk, generateWorkspaceWrk, unwrapWrk } = await import('../kms');

		const workspaceId = 'workspace-delete';
		const { encryptedWrk, kmsContext } = await generateWorkspaceWrk(workspaceId);
		const marker = encryptedWrk.toString('utf8');
		const parsed = JSON.parse(marker.slice('gordian:keychain:workspace-wrk:v1:'.length)) as {
			account: string;
			service: string;
		};

		expect(keychain.has(`${parsed.service}:${parsed.account}`)).toBe(true);

		await deleteWorkspaceWrk(workspaceId, encryptedWrk);

		expect(keychain.has(`${parsed.service}:${parsed.account}`)).toBe(false);
		await expect(unwrapWrk({ encryptedWrk, kmsContext, wrkVersion: 1 })).rejects.toThrow(
			/Keychain item could not be found/,
		);
	});

	it('refuses to unwrap a workspace keychain marker for the wrong workspace', async () => {
		const { generateWorkspaceWrk, unwrapWrk } = await import('../kms');

		const { encryptedWrk } = await generateWorkspaceWrk('workspace-a');

		await expect(
			unwrapWrk({
				encryptedWrk,
				kmsContext: { WorkspaceID: 'workspace-b', Purpose: 'workspace-root-key' },
				wrkVersion: 1,
			}),
		).rejects.toThrow(/Invalid workspace OS keychain marker/);
	});

	it('refuses raw local WRK blobs when os-keychain mode is selected', async () => {
		const { unwrapWrk } = await import('../kms');

		await expect(
			unwrapWrk({
				encryptedWrk: Buffer.alloc(32, 7),
				kmsContext: { WorkspaceID: 'workspace-raw', Purpose: 'workspace-root-key' },
				wrkVersion: 1,
			}),
		).rejects.toThrow(/WORKSPACE_KEY_PROVIDER=os-keychain requires/);
	});

	it('allows the workspace key cache TTL to be configured', async () => {
		process.env.WORKSPACE_KEY_CACHE_TTL_MINUTES = '60';
		const { generateWorkspaceWrk, unwrapWrk } = await import('../kms');

		const envelope = {
			...(await generateWorkspaceWrk('workspace-cache')),
			wrkVersion: 1,
		};

		const first = await unwrapWrk(envelope);
		const second = await unwrapWrk(envelope);

		expect(second.equals(first)).toBe(true);
		expect(keychainGetCalls()).toHaveLength(1);
	});
});

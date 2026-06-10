import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	isTelegramBotEnabled,
	isTelegramFullBackfillEnabled,
	isTelegramMtProtoEnabled,
	isTelegramMtProtoPerInteractionUnlockEnabled,
	isTelegramPeriodicSyncEnabled,
	isTelegramSendEnabled,
	requireTelegramMtProtoConfig,
} from '../telegram-config';

vi.mock('node:child_process', () => ({
	execFileSync: vi.fn(),
}));

const execFileSyncMock = vi.mocked(execFileSync);
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const telegramKeychainServiceEnv = ['TELEGRAM', 'KEYCHAIN', 'SERVICE'].join('_');
const telegramApiHashEnv = ['TELEGRAM', 'API', 'HASH'].join('_');
const fakeKeychainService = ['gordian', 'v2', 'test'].join('-');
const fakeTelegramApiHash = ['0123456789abcdef', '0123456789abcdef'].join('');
const telegramFeatureFlagEnvNames = [
	'TELEGRAM_BOT_ENABLED',
	'TELEGRAM_MTPROTO_ENABLED',
	'TELEGRAM_SEND_ENABLED',
	'TELEGRAM_FULL_BACKFILL_ENABLED',
	'TELEGRAM_PERIODIC_SYNC_ENABLED',
] as const;

function stubProcessPlatform(platform: NodeJS.Platform) {
	Object.defineProperty(process, 'platform', {
		value: platform,
	});
}

describe('Telegram deployment feature gates', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('keeps all Telegram runtime capabilities disabled by default', () => {
		for (const envName of telegramFeatureFlagEnvNames) {
			vi.stubEnv(envName, '');
		}

		expect(isTelegramBotEnabled()).toBe(false);
		expect(isTelegramMtProtoEnabled()).toBe(false);
		expect(isTelegramSendEnabled()).toBe(false);
		expect(isTelegramFullBackfillEnabled()).toBe(false);
		expect(isTelegramPeriodicSyncEnabled()).toBe(false);
	});

	it('requires explicit true values before enabling Telegram runtime capabilities', () => {
		for (const envName of telegramFeatureFlagEnvNames) {
			vi.stubEnv(envName, 'false');
		}

		expect(isTelegramBotEnabled()).toBe(false);
		expect(isTelegramMtProtoEnabled()).toBe(false);
		expect(isTelegramSendEnabled()).toBe(false);
		expect(isTelegramFullBackfillEnabled()).toBe(false);
		expect(isTelegramPeriodicSyncEnabled()).toBe(false);

		for (const envName of telegramFeatureFlagEnvNames) {
			vi.stubEnv(envName, 'true');
		}

		expect(isTelegramBotEnabled()).toBe(true);
		expect(isTelegramMtProtoEnabled()).toBe(true);
		expect(isTelegramSendEnabled()).toBe(true);
		expect(isTelegramFullBackfillEnabled()).toBe(true);
		expect(isTelegramPeriodicSyncEnabled()).toBe(true);
	});
});

describe('requireTelegramMtProtoConfig', () => {
	afterEach(() => {
		if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it('reads Telegram API credentials from env mode', () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_API_CREDENTIAL_PROVIDER', 'env');
		vi.stubEnv('TELEGRAM_API_ID', '12345');
		vi.stubEnv(telegramApiHashEnv, fakeTelegramApiHash);

		expect(requireTelegramMtProtoConfig()).toEqual({
			apiHash: fakeTelegramApiHash,
			apiId: 12345,
		});
		expect(execFileSyncMock).not.toHaveBeenCalled();
	});

	it('reads Telegram API credentials from macOS Keychain mode', () => {
		stubProcessPlatform('darwin');
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_API_CREDENTIAL_PROVIDER', 'os-keychain');
		vi.stubEnv(telegramKeychainServiceEnv, fakeKeychainService);
		vi.stubEnv('TELEGRAM_API_KEYCHAIN_ACCOUNT', 'telegram-api-credentials-test');
		execFileSyncMock.mockReturnValue(
			JSON.stringify({
				apiHash: fakeTelegramApiHash,
				apiId: '54321',
				version: 1,
			}),
		);

		expect(requireTelegramMtProtoConfig()).toEqual({
			apiHash: fakeTelegramApiHash,
			apiId: 54321,
		});
		expect(execFileSyncMock).toHaveBeenCalledWith(
			'security',
			[
				'find-generic-password',
				'-a',
				'telegram-api-credentials-test',
				'-s',
				fakeKeychainService,
				'-w',
			],
			{ encoding: 'utf8' },
		);
	});

	it('uses the configured Gordian helper for Telegram API Keychain reads', () => {
		stubProcessPlatform('darwin');
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_API_CREDENTIAL_PROVIDER', 'os-keychain');
		vi.stubEnv(telegramKeychainServiceEnv, fakeKeychainService);
		vi.stubEnv('TELEGRAM_API_KEYCHAIN_ACCOUNT', 'telegram-api-credentials-helper');
		vi.stubEnv(
			'GORDIAN_KEYCHAIN_HELPER_PATH',
			'/Applications/GordianKeychainBroker.app/Contents/MacOS/GordianKeychainBroker',
		);
		execFileSyncMock.mockReturnValue(
			JSON.stringify({
				apiHash: fakeTelegramApiHash,
				apiId: '67890',
				version: 1,
			}),
		);

		expect(requireTelegramMtProtoConfig()).toEqual({
			apiHash: fakeTelegramApiHash,
			apiId: 67890,
		});
		expect(execFileSyncMock).toHaveBeenCalledWith(
			'/Applications/GordianKeychainBroker.app/Contents/MacOS/GordianKeychainBroker',
			['get', fakeKeychainService, 'telegram-api-credentials-helper', 'standard'],
			{ encoding: 'utf8' },
		);
	});

	it('caches Telegram API credentials after the first Keychain read', () => {
		stubProcessPlatform('darwin');
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_API_CREDENTIAL_PROVIDER', 'os-keychain');
		vi.stubEnv(telegramKeychainServiceEnv, fakeKeychainService);
		vi.stubEnv('TELEGRAM_API_KEYCHAIN_ACCOUNT', 'telegram-api-credentials-test-cache');
		execFileSyncMock.mockReturnValue(
			JSON.stringify({
				apiHash: fakeTelegramApiHash,
				apiId: '54321',
				version: 1,
			}),
		);

		expect(requireTelegramMtProtoConfig()).toEqual({
			apiHash: fakeTelegramApiHash,
			apiId: 54321,
		});
		expect(requireTelegramMtProtoConfig()).toEqual({
			apiHash: fakeTelegramApiHash,
			apiId: 54321,
		});
		expect(execFileSyncMock).toHaveBeenCalledTimes(1);
	});

	it('defaults Telegram API credentials to the Telegram Keychain service', () => {
		stubProcessPlatform('darwin');
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_API_CREDENTIAL_PROVIDER', 'os-keychain');
		execFileSyncMock.mockReturnValue(
			JSON.stringify({
				apiHash: fakeTelegramApiHash,
				apiId: '54321',
				version: 1,
			}),
		);

		expect(requireTelegramMtProtoConfig()).toEqual({
			apiHash: fakeTelegramApiHash,
			apiId: 54321,
		});
		expect(execFileSyncMock).toHaveBeenCalledWith(
			'security',
			[
				'find-generic-password',
				'-a',
				'telegram-api-credentials',
				'-s',
				'gordian-v2-telegram',
				'-w',
			],
			{ encoding: 'utf8' },
		);
	});

	it('rejects unsupported credential providers', () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_API_CREDENTIAL_PROVIDER', 'plaintext');

		expect(() => requireTelegramMtProtoConfig()).toThrow(
			/Invalid TELEGRAM_API_CREDENTIAL_PROVIDER/,
		);
	});
});

describe('isTelegramMtProtoPerInteractionUnlockEnabled', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('defaults to per-import-run unlock', () => {
		expect(isTelegramMtProtoPerInteractionUnlockEnabled()).toBe(false);
	});

	it('allows explicit per-interaction unlock for stricter local testing', () => {
		vi.stubEnv('TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK', 'true');

		expect(isTelegramMtProtoPerInteractionUnlockEnabled()).toBe(true);
	});

	it('rejects invalid values', () => {
		vi.stubEnv('TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK', 'sometimes');

		expect(() => isTelegramMtProtoPerInteractionUnlockEnabled()).toThrow(
			/Invalid TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK/,
		);
	});
});

import { execFileSync } from 'node:child_process';

const TRUE_VALUE = 'true';
const DEFAULT_KEYCHAIN_SERVICE = 'gordian-v2-telegram';
const DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT = 'telegram-api-credentials';

function isEnabled(value: string | undefined): boolean {
	return value?.toLowerCase() === TRUE_VALUE;
}

export function isTelegramBotEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_BOT_ENABLED);
}

export function isTelegramMtProtoEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_MTPROTO_ENABLED);
}

export function isTelegramSendEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_SEND_ENABLED);
}

export function isTelegramFullBackfillEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_FULL_BACKFILL_ENABLED);
}

export function isTelegramPeriodicSyncEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_PERIODIC_SYNC_ENABLED);
}

export function isTelegramMtProtoPerInteractionUnlockEnabled(): boolean {
	const configured = process.env.TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK?.trim();
	if (!configured) return false;
	if (configured === 'true') return true;
	if (configured === 'false') return false;
	throw new Error(
		`Invalid TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="${configured}". Expected true or false.`,
	);
}

type TelegramApiCredentialProvider = 'env' | 'os-keychain';
type TelegramMtProtoConfig = { apiId: number; apiHash: string };

let cachedMtProtoConfig: { key: string; value: TelegramMtProtoConfig } | null = null;

function getTelegramApiCredentialProvider(): TelegramApiCredentialProvider {
	const configured = process.env.TELEGRAM_API_CREDENTIAL_PROVIDER?.trim();
	if (!configured) return 'env';
	if (configured === 'env' || configured === 'os-keychain') return configured;
	throw new Error(
		`Invalid TELEGRAM_API_CREDENTIAL_PROVIDER="${configured}". Expected env or os-keychain.`,
	);
}

function readTelegramApiCredentialsFromKeychain(): { apiId: string; apiHash: string } {
	if (process.platform !== 'darwin') {
		throw new Error('TELEGRAM_API_CREDENTIAL_PROVIDER=os-keychain requires macOS Keychain');
	}

	const stdout = execFileSync(
		'security',
		[
			'find-generic-password',
			'-a',
			process.env.TELEGRAM_API_KEYCHAIN_ACCOUNT?.trim() || DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT,
			'-s',
			process.env.TELEGRAM_KEYCHAIN_SERVICE?.trim() || DEFAULT_KEYCHAIN_SERVICE,
			'-w',
		],
		{ encoding: 'utf8' },
	);
	const parsed = JSON.parse(stdout.trim()) as { apiHash?: unknown; apiId?: unknown };
	return {
		apiHash: String(parsed.apiHash ?? ''),
		apiId: String(parsed.apiId ?? ''),
	};
}

function getTelegramApiCredentials(): { apiId: string; apiHash: string } {
	if (getTelegramApiCredentialProvider() === 'os-keychain') {
		return readTelegramApiCredentialsFromKeychain();
	}

	return {
		apiHash: process.env.TELEGRAM_API_HASH ?? '',
		apiId: process.env.TELEGRAM_API_ID ?? '',
	};
}

function telegramMtProtoConfigCacheKey(): string {
	const provider = getTelegramApiCredentialProvider();
	return JSON.stringify({
		provider,
		apiId: provider === 'env' ? (process.env.TELEGRAM_API_ID ?? '') : '',
		apiHash: provider === 'env' ? (process.env.TELEGRAM_API_HASH ?? '') : '',
		account:
			provider === 'os-keychain'
				? process.env.TELEGRAM_API_KEYCHAIN_ACCOUNT?.trim() || DEFAULT_TELEGRAM_API_KEYCHAIN_ACCOUNT
				: '',
		service:
			provider === 'os-keychain'
				? process.env.TELEGRAM_KEYCHAIN_SERVICE?.trim() || DEFAULT_KEYCHAIN_SERVICE
				: '',
	});
}

export function requireTelegramMtProtoConfig(): TelegramMtProtoConfig {
	if (!isTelegramMtProtoEnabled()) {
		throw new Error('Telegram MTProto integration is disabled');
	}

	const cacheKey = telegramMtProtoConfigCacheKey();
	if (cachedMtProtoConfig?.key === cacheKey) {
		return cachedMtProtoConfig.value;
	}

	const credentials = getTelegramApiCredentials();
	const apiId = Number(credentials.apiId);
	const apiHash = credentials.apiHash;

	if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
		throw new Error('Telegram API credentials must be configured');
	}

	const value = { apiId, apiHash };
	cachedMtProtoConfig = { key: cacheKey, value };
	return value;
}

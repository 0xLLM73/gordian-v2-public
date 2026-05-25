import { execFileSync } from 'node:child_process';

const TRUE_VALUE = 'true';
const DEFAULT_KEYCHAIN_SERVICE = 'gordian-v2';
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

type TelegramApiCredentialProvider = 'env' | 'os-keychain';

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

export function requireTelegramMtProtoConfig(): { apiId: number; apiHash: string } {
	if (!isTelegramMtProtoEnabled()) {
		throw new Error('Telegram MTProto integration is disabled');
	}

	const credentials = getTelegramApiCredentials();
	const apiId = Number(credentials.apiId);
	const apiHash = credentials.apiHash;

	if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
		throw new Error('Telegram API credentials must be configured');
	}

	return { apiId, apiHash };
}

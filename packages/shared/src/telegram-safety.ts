export const TELEGRAM_CONSENT_VERSION = 2;

export const TELEGRAM_SYNC_SCOPES = [
	'contacts_only',
	'private_recent',
	'private_recent_with_groups',
] as const;

export type TelegramSyncScope = (typeof TELEGRAM_SYNC_SCOPES)[number];

export const DEFAULT_TELEGRAM_SYNC_SCOPE: TelegramSyncScope = 'contacts_only';

export function isTelegramSyncScope(value: unknown): value is TelegramSyncScope {
	return typeof value === 'string' && TELEGRAM_SYNC_SCOPES.includes(value as TelegramSyncScope);
}

export function resolveTelegramSyncScope(value: unknown): TelegramSyncScope {
	return isTelegramSyncScope(value) ? value : DEFAULT_TELEGRAM_SYNC_SCOPE;
}

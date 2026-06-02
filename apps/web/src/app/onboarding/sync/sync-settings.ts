import type { TelegramSyncScope } from '@repo/shared';

export const TELEGRAM_LINKING_ENABLED = process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED === 'true';

export const AI_SYNC_ENABLED =
	process.env.NEXT_PUBLIC_AI_PROCESSING_ENABLED === 'true' ||
	process.env.NEXT_PUBLIC_LOCAL_AI_PROCESSING_ENABLED === 'true';

type AiSyncMode = 'disabled' | 'local' | 'cloud' | 'mixed';

export const AI_SYNC_MODE: AiSyncMode = getAiSyncMode({
	cloudEnabled: process.env.NEXT_PUBLIC_AI_PROCESSING_ENABLED === 'true',
	localEnabled: process.env.NEXT_PUBLIC_LOCAL_AI_PROCESSING_ENABLED === 'true',
});

export const SYNC_OPTIONS: Array<{
	value: TelegramSyncScope;
	title: string;
	description: string;
}> = [
	{
		value: 'contacts_only',
		title: 'Import contacts only',
		description: 'Add your Telegram contacts without reading conversation history.',
	},
	{
		value: 'private_recent',
		title: 'Import contacts + recent private chats',
		description:
			'Add contacts first, then import recent one-to-one chats. Groups, channels, full history, and sending stay off.',
	},
	{
		value: 'private_recent_with_groups',
		title: 'Import contacts + recent private chats + groups',
		description:
			'Add contacts first, then import recent one-to-one chats and recent group messages. Channels, full history, and sending stay off.',
	},
];

export function getSyncScopeSafetyDetails(syncScope: TelegramSyncScope): string[] {
	const baseline = [
		'Message sending stays disabled.',
		'Full-history backfill stays disabled.',
		'Periodic background sync stays disabled.',
	];

	if (syncScope === 'contacts_only') {
		return [
			'Conversation history is not imported.',
			'AI analysis is not used for this scope.',
			...baseline,
		];
	}

	if (syncScope === 'private_recent_with_groups') {
		return [
			'Recent private chats and recent group messages are imported.',
			'Channels and full account history stay out of scope.',
			...baseline,
		];
	}

	return [
		'Recent one-to-one chats are imported.',
		'Groups, channels, and full account history stay out of scope.',
		...baseline,
	];
}

export function getSyncStartedDescription(syncScope: TelegramSyncScope): string {
	if (syncScope === 'contacts_only') {
		return 'Gordian is importing your Telegram contacts.';
	}
	if (syncScope === 'private_recent_with_groups') {
		return 'Gordian is importing contacts, recent private chats, and recent group messages.';
	}
	return 'Gordian is importing contacts and recent private chats.';
}

export function getAiSyncMode({
	cloudEnabled,
	localEnabled,
}: {
	cloudEnabled: boolean;
	localEnabled: boolean;
}): AiSyncMode {
	if (cloudEnabled && localEnabled) return 'mixed';
	if (cloudEnabled) return 'cloud';
	if (localEnabled) return 'local';
	return 'disabled';
}

export function getAiProcessingImportDescription(mode: AiSyncMode = AI_SYNC_MODE): string {
	if (mode === 'local') {
		return 'AI analysis stays off by default. If enabled, eligible imported messages are analyzed by configured local models without vendor AI egress.';
	}

	if (mode === 'cloud') {
		return 'AI analysis stays off by default. If enabled, eligible imported messages may be summarized, embedded, or classified by configured cloud AI providers.';
	}

	if (mode === 'mixed') {
		return 'AI analysis stays off by default. If enabled, eligible imported messages may use configured local models or cloud AI providers, depending on the active role configuration.';
	}

	return 'AI analysis is unavailable in this build, so imported messages are not sent to AI providers.';
}

export function resolveAiProcessingForSync({
	aiSyncEnabled = AI_SYNC_ENABLED,
	requested,
	syncScope,
}: {
	aiSyncEnabled?: boolean;
	requested: boolean;
	syncScope: TelegramSyncScope;
}): boolean {
	return aiSyncEnabled && syncScope !== 'contacts_only' && requested;
}

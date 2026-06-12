import { describe, expect, it } from 'vitest';

import {
	getAiProcessingImportDescription,
	getAiSyncMode,
	getSyncScopeSafetyDetails,
	getSyncStartedDescription,
	resolveAiProcessingForSync,
	SYNC_OPTIONS,
} from '@/app/onboarding/sync/sync-settings';

describe('resolveAiProcessingForSync', () => {
	it('forces contacts-only imports to run without AI analysis', () => {
		expect(
			resolveAiProcessingForSync({
				aiSyncEnabled: true,
				requested: true,
				syncScope: 'contacts_only',
			}),
		).toBe(false);
	});

	it('forces AI off when the public AI sync flag is disabled', () => {
		expect(
			resolveAiProcessingForSync({
				aiSyncEnabled: false,
				requested: true,
				syncScope: 'private_recent',
			}),
		).toBe(false);
	});

	it('allows AI analysis only when requested and available for message imports', () => {
		expect(
			resolveAiProcessingForSync({
				aiSyncEnabled: true,
				requested: true,
				syncScope: 'private_recent',
			}),
		).toBe(true);
		expect(
			resolveAiProcessingForSync({
				aiSyncEnabled: true,
				requested: true,
				syncScope: 'private_recent_with_groups',
			}),
		).toBe(true);
	});

	it('makes clear what each import scope includes', () => {
		const privateRecent = SYNC_OPTIONS.find((option) => option.value === 'private_recent');
		const privateRecentWithGroups = SYNC_OPTIONS.find(
			(option) => option.value === 'private_recent_with_groups',
		);

		expect(privateRecent?.title).toContain('contacts + recent private chats');
		expect(privateRecent?.description).toContain('Add contacts first');
		expect(getSyncStartedDescription('private_recent')).toContain(
			'contacts and recent private chats',
		);
		expect(privateRecentWithGroups?.title).toContain('contacts + recent private chats + groups');
		expect(privateRecentWithGroups?.description).toContain('recent group messages');
		expect(getSyncStartedDescription('private_recent_with_groups')).toContain(
			'recent group messages',
		);
	});

	it('keeps the import safety copy aligned with each scope', () => {
		expect(getSyncScopeSafetyDetails('contacts_only')).toEqual(
			expect.arrayContaining([
				'Conversation history is not imported.',
				'AI analysis is not used for this scope.',
				'Message sending stays disabled.',
			]),
		);
		expect(getSyncScopeSafetyDetails('private_recent')).toEqual(
			expect.arrayContaining([
				'Recent one-to-one chats are imported.',
				'Groups, channels, and full account history stay out of scope.',
				'Full-history backfill stays disabled.',
			]),
		);
		expect(getSyncScopeSafetyDetails('private_recent_with_groups')).toEqual(
			expect.arrayContaining([
				'Recent private chats and recent group messages are imported.',
				'Channels and full account history stay out of scope.',
				'Periodic background sync stays disabled.',
			]),
		);
	});

	it('describes AI import processing according to configured provider mode', () => {
		expect(getAiSyncMode({ cloudEnabled: false, localEnabled: false })).toBe('disabled');
		expect(getAiSyncMode({ cloudEnabled: false, localEnabled: true })).toBe('local');
		expect(getAiSyncMode({ cloudEnabled: true, localEnabled: false })).toBe('cloud');
		expect(getAiSyncMode({ cloudEnabled: true, localEnabled: true })).toBe('mixed');

		expect(getAiProcessingImportDescription('local')).toContain('configured local models');
		expect(getAiProcessingImportDescription('local')).toContain('without vendor AI egress');
		expect(getAiProcessingImportDescription('cloud')).toContain('cloud AI providers');
		expect(getAiProcessingImportDescription('mixed')).toContain(
			'configured local models or cloud AI providers',
		);
		expect(getAiProcessingImportDescription('disabled')).toContain('unavailable');
	});
});

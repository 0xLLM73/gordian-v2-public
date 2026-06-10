import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetWorkspaceEnvelope = vi.hoisted(() => vi.fn());
const mockGetPreferences = vi.hoisted(() => vi.fn());
const mockGetStaleContacts = vi.hoisted(() => vi.fn());
const mockGetHealthScoresByContactIds = vi.hoisted(() => vi.fn());
const MockGhostingAlertCard = vi.hoisted(
	() =>
		function MockGhostingAlertCard(_props: unknown) {
			return null;
		},
);

vi.mock('@/lib/workspace', () => ({
	getWorkspaceEnvelope: mockGetWorkspaceEnvelope,
}));

vi.mock('@repo/db', () => ({
	getPreferences: mockGetPreferences,
	getStaleContacts: mockGetStaleContacts,
	getHealthScoresByContactIds: mockGetHealthScoresByContactIds,
}));

vi.mock('@/components/ghosting-alert-card', () => ({
	GhostingAlertCard: MockGhostingAlertCard,
}));

vi.stubGlobal('React', React);

const WORKSPACE_ID = 'ws-00000000-0000-0000-0000-000000000001';
const USER_ID = 'user-00000000-0000-0000-0000-000000000001';
const mockEnvelope = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: WORKSPACE_ID },
	wrkVersion: 1,
};

describe('GhostingAlertSection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetWorkspaceEnvelope.mockResolvedValue(mockEnvelope);
		mockGetPreferences.mockResolvedValue({
			ghostingAlertStatuses: ['cooling', 'dormant'],
			ghostingStaleDays: 30,
		});
		mockGetStaleContacts.mockResolvedValue([]);
		mockGetHealthScoresByContactIds.mockResolvedValue([]);
	});

	it('does not show alerts when all ghosting statuses are disabled', async () => {
		mockGetPreferences.mockResolvedValueOnce({
			ghostingAlertStatuses: [],
			ghostingStaleDays: 30,
		});

		const { GhostingAlertSection } = await import('@/components/ghosting-alert-section');
		const result = await GhostingAlertSection({ workspaceId: WORKSPACE_ID, userId: USER_ID });

		expect(result).toBeNull();
		expect(mockGetStaleContacts).not.toHaveBeenCalled();
		expect(mockGetHealthScoresByContactIds).not.toHaveBeenCalled();
	});

	it('enriches exact stale contacts with health labels before filtering', async () => {
		mockGetPreferences.mockResolvedValueOnce({
			ghostingAlertStatuses: ['cooling'],
			ghostingStaleDays: 30,
		});
		mockGetStaleContacts.mockResolvedValueOnce([
			{
				id: 'contact-healthy',
				firstName: 'A',
				lastName: null,
				lastMessageAt: new Date('2026-01-01T00:00:00Z'),
				messageCount: 12,
			},
			{
				id: 'contact-cooling',
				firstName: 'B',
				lastName: null,
				lastMessageAt: new Date('2026-01-02T00:00:00Z'),
				messageCount: 8,
			},
		]);
		mockGetHealthScoresByContactIds.mockResolvedValueOnce([
			{ contactId: 'contact-healthy', label: 'healthy' },
			{ contactId: 'contact-cooling', label: 'cooling' },
		]);

		const { GhostingAlertSection } = await import('@/components/ghosting-alert-section');
		const result = await GhostingAlertSection({ workspaceId: WORKSPACE_ID, userId: USER_ID });

		expect(mockGetStaleContacts).toHaveBeenCalledWith(WORKSPACE_ID, mockEnvelope, {
			staleDays: 30,
			limit: 10,
		});
		expect(mockGetHealthScoresByContactIds).toHaveBeenCalledWith(WORKSPACE_ID, [
			'contact-healthy',
			'contact-cooling',
		]);
		expect(result).toEqual(
			expect.objectContaining({
				type: MockGhostingAlertCard,
				props: expect.objectContaining({
					contacts: [
						expect.objectContaining({
							id: 'contact-cooling',
							healthLabel: 'cooling',
						}),
					],
				}),
			}),
		);
	});
});

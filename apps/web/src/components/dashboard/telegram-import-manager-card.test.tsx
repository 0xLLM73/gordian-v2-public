import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramImportManagerCard } from './telegram-import-manager-card';

const mockGetTelegramImportStatusAction = vi.hoisted(() => vi.fn());

vi.stubGlobal('React', React);

vi.mock('@/app/actions/sync', () => ({
	cancelTelegramImportAction: vi.fn(),
	getTelegramImportStatusAction: mockGetTelegramImportStatusAction,
	pauseTelegramImportAction: vi.fn(),
	resumeTelegramImportAction: vi.fn(),
	startTelegramImportAction: vi.fn(),
}));

describe('TelegramImportManagerCard', () => {
	beforeEach(() => {
		mockGetTelegramImportStatusAction.mockReset();
	});

	it('shows large import safety status before any import starts', async () => {
		mockGetTelegramImportStatusAction.mockResolvedValue({ data: {} });

		render(React.createElement(TelegramImportManagerCard));

		await waitFor(() => {
			expect(screen.getByText('Import safety')).toBeTruthy();
		});
		expect(screen.getByText('Message sending')).toBeTruthy();
		expect(screen.getByText('AI analysis')).toBeTruthy();
		expect(screen.getByText('Channels')).toBeTruthy();
		expect(screen.getByText('Local worker')).toBeTruthy();
		expect(screen.getAllByText('Off')).toHaveLength(2);
		expect(screen.getAllByText('Skipped')).toHaveLength(2);
		expect(screen.getByText('Required')).toBeTruthy();
	});

	it('explains when the latest completed import is a no-op after a real data import', async () => {
		mockGetTelegramImportStatusAction.mockResolvedValue({
			data: {
				import: {
					runId: 'latest-noop',
					status: 'completed',
					totalDialogs: 14,
					eligibleDialogs: 6,
					skippedDialogs: 8,
					chatsQueued: 0,
					chatsCompleted: 0,
					chatsFailed: 0,
					messagesSeen: 0,
					messagesInserted: 0,
					duplicateMessages: 0,
					pagesFetched: 0,
					lastHeartbeatAt: null,
					errorCode: null,
					errorMessage: null,
				},
				lastDataImport: {
					runId: 'previous-large-import',
					status: 'completed',
					totalDialogs: 8,
					eligibleDialogs: 6,
					skippedDialogs: 2,
					chatsQueued: 6,
					chatsCompleted: 6,
					chatsFailed: 0,
					messagesSeen: 4108,
					messagesInserted: 4108,
					duplicateMessages: 0,
					pagesFetched: 46,
					lastHeartbeatAt: null,
					errorCode: null,
					errorMessage: null,
				},
			},
		});

		render(React.createElement(TelegramImportManagerCard));

		await waitFor(() => {
			expect(screen.getByText(/latest check completed with no new chats/i)).toBeTruthy();
		});
		expect(screen.getByText(/last data import added 4,108 messages/i)).toBeTruthy();
		expect(screen.getByText(/last data import: 4,108 messages/i)).toBeTruthy();
	});

	it('shows completed import summary without active-run controls', async () => {
		mockGetTelegramImportStatusAction.mockResolvedValue({
			data: {
				import: {
					runId: 'completed-import',
					status: 'completed',
					totalDialogs: 100,
					eligibleDialogs: 87,
					skippedDialogs: 85,
					chatsQueued: 15,
					chatsCompleted: 15,
					chatsFailed: 0,
					messagesSeen: 317914,
					messagesInserted: 317914,
					duplicateMessages: 0,
					pagesFetched: 3188,
					lastHeartbeatAt: null,
					errorCode: null,
					errorMessage: null,
				},
			},
		});

		render(React.createElement(TelegramImportManagerCard));

		await waitFor(() => {
			expect(screen.getByText(/latest import completed with 317,914 messages/i)).toBeTruthy();
		});
		expect(
			screen.queryByText(/keep the local app and worker running while import is active/i),
		).toBeNull();
		expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
		expect(screen.getByRole('button', { name: /start large import/i })).toBeTruthy();
	});
});

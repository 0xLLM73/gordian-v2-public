import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepSendStatus, getFollowUpStepSendStatus } from './step-send-status';

describe('StepSendStatus', () => {
	beforeEach(() => {
		vi.stubGlobal('React', React);
	});

	it('warns when a copied draft has not been manually confirmed', () => {
		render(
			React.createElement(StepSendStatus, {
				records: [
					{
						status: 'copied',
						copiedAt: '2026-06-09T12:00:00Z',
						createdAt: '2026-06-09T12:00:00Z',
					},
				],
			}),
		);

		expect(screen.getByText('Draft copied, not confirmed')).toBeTruthy();
		expect(
			screen.getByText('Not marked sent. The plan will not advance until you confirm.'),
		).toBeTruthy();
	});

	it('warns when Telegram was opened but the step is not confirmed sent', () => {
		const status = getFollowUpStepSendStatus([
			{
				status: 'copied',
				copiedAt: '2026-06-09T11:00:00Z',
				createdAt: '2026-06-09T11:00:00Z',
			},
			{
				status: 'telegram_opened',
				telegramOpenedAt: '2026-06-09T12:00:00Z',
				createdAt: '2026-06-09T12:00:00Z',
			},
		]);

		expect(status.label).toBe('Telegram opened, not confirmed');
		expect(status.tone).toBe('warn');
	});

	it('shows manual confirmation as complete', () => {
		const status = getFollowUpStepSendStatus([
			{
				status: 'copied',
				copiedAt: '2026-06-09T11:00:00Z',
				createdAt: '2026-06-09T11:00:00Z',
			},
			{
				status: 'manual_confirmed',
				manualConfirmedAt: '2026-06-09T12:00:00Z',
				createdAt: '2026-06-09T12:00:00Z',
			},
		]);

		expect(status.label).toBe('Manual send confirmed');
		expect(status.tone).toBe('ok');
	});
});

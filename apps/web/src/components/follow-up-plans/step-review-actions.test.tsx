import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
	approveAction: vi.fn(),
	editAndApproveAction: vi.fn(),
	rejectAction: vi.fn(),
	regenerateAction: vi.fn(),
	rescheduleAction: vi.fn(),
	copyAction: vi.fn(),
	telegramOpenAction: vi.fn(),
	approveExecute: vi.fn(),
	editAndApproveExecute: vi.fn(),
	rejectExecute: vi.fn(),
	regenerateExecute: vi.fn(),
	rescheduleExecute: vi.fn(),
	copyExecute: vi.fn(),
	telegramOpenExecute: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock('@/app/actions/follow-up-plans', () => ({
	approveFollowUpPlanStepAction: actionMocks.approveAction,
	editAndApproveFollowUpPlanStepAction: actionMocks.editAndApproveAction,
	rejectFollowUpPlanStepAction: actionMocks.rejectAction,
	regenerateFollowUpPlanStepAction: actionMocks.regenerateAction,
	rescheduleFollowUpPlanStepAction: actionMocks.rescheduleAction,
	recordFollowUpPlanStepCopyAction: actionMocks.copyAction,
	recordFollowUpPlanTelegramOpenAction: actionMocks.telegramOpenAction,
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: actionMocks.refresh }),
}));

vi.mock('next-safe-action/hooks', () => ({
	useAction: vi.fn((action: unknown) => {
		if (action === actionMocks.approveAction) {
			return { execute: actionMocks.approveExecute, isExecuting: false };
		}
		if (action === actionMocks.editAndApproveAction) {
			return { execute: actionMocks.editAndApproveExecute, isExecuting: false };
		}
		if (action === actionMocks.rejectAction) {
			return { execute: actionMocks.rejectExecute, isExecuting: false };
		}
		if (action === actionMocks.regenerateAction) {
			return { execute: actionMocks.regenerateExecute, isExecuting: false };
		}
		if (action === actionMocks.rescheduleAction) {
			return { execute: actionMocks.rescheduleExecute, isExecuting: false };
		}
		if (action === actionMocks.copyAction) {
			return { execute: actionMocks.copyExecute, isExecuting: false };
		}
		if (action === actionMocks.telegramOpenAction) {
			return { execute: actionMocks.telegramOpenExecute, isExecuting: false };
		}
		return { execute: vi.fn(), isExecuting: false };
	}),
}));

describe('StepReviewActions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('React', React);
		vi.stubGlobal('open', vi.fn());
		Object.assign(navigator, {
			clipboard: {
				writeText: vi.fn(() => Promise.resolve()),
			},
		});
	});

	it('records copying a draft without marking the draft sent', async () => {
		const { StepReviewActions } = await import('./step-review-actions');

		render(
			React.createElement(StepReviewActions, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
				draftText: 'Can we reconnect this week?',
				telegramUrl: 'https://t.me/example_user',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Copy draft' }));

		expect(
			await screen.findByText('Draft copied. Send it manually, then mark it sent here.'),
		).toBeTruthy();
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Can we reconnect this week?');
		expect(actionMocks.copyExecute).toHaveBeenCalledWith({
			stepId: '550e8400-e29b-41d4-a716-446655440003',
			followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
		});
		expect(actionMocks.approveExecute).not.toHaveBeenCalled();
	});

	it('records opening Telegram without marking the draft sent', async () => {
		const { StepReviewActions } = await import('./step-review-actions');

		render(
			React.createElement(StepReviewActions, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
				draftText: 'Can we reconnect this week?',
				telegramUrl: 'https://t.me/example_user',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Open Telegram' }));

		expect(actionMocks.telegramOpenExecute).toHaveBeenCalledWith({
			stepId: '550e8400-e29b-41d4-a716-446655440003',
			followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
		});
		expect(window.open).toHaveBeenCalledWith(
			'https://t.me/example_user',
			'_blank',
			'noopener,noreferrer',
		);
		expect(actionMocks.approveExecute).not.toHaveBeenCalled();
		expect(
			screen.getByText('Telegram opened. Send the draft manually, then mark it sent here.'),
		).toBeTruthy();
	});

	it('requires inline confirmation before marking a manual send complete', async () => {
		const { StepReviewActions } = await import('./step-review-actions');

		render(
			React.createElement(StepReviewActions, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
				draftText: 'Can we reconnect this week?',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Mark manually sent' }));

		expect(actionMocks.approveExecute).not.toHaveBeenCalled();
		expect(
			screen.getByText(
				'This records that you manually sent the draft and schedules the next step.',
			),
		).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Confirm sent' }));

		expect(actionMocks.approveExecute).toHaveBeenCalledWith({
			stepId: '550e8400-e29b-41d4-a716-446655440003',
			followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
		});
	});

	it('captures an optional skip reason without marking the draft sent', async () => {
		const { StepReviewActions } = await import('./step-review-actions');

		render(
			React.createElement(StepReviewActions, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
				draftText: 'Can we reconnect this week?',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Skip step' }));
		expect(
			screen.getByText('Skip this draft and move the plan forward without sending anything.'),
		).toBeTruthy();
		fireEvent.change(screen.getByPlaceholderText('Optional skip reason'), {
			target: { value: 'Already handled directly' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Confirm skip' }));

		expect(actionMocks.rejectExecute).toHaveBeenCalledWith({
			stepId: '550e8400-e29b-41d4-a716-446655440003',
			followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
			skipReason: 'Already handled directly',
		});
		expect(actionMocks.approveExecute).not.toHaveBeenCalled();
	});

	it('reschedules a review draft without marking the draft sent', async () => {
		vi.stubGlobal(
			'prompt',
			vi.fn().mockReturnValueOnce('24').mockReturnValueOnce('Need fresh context tomorrow'),
		);
		const { StepReviewActions } = await import('./step-review-actions');

		render(
			React.createElement(StepReviewActions, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
				draftText: 'Can we reconnect this week?',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));

		expect(actionMocks.rescheduleExecute).toHaveBeenCalledWith({
			stepId: '550e8400-e29b-41d4-a716-446655440003',
			followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
			scheduledAt: expect.any(String),
			reason: 'Need fresh context tomorrow',
		});
		expect(actionMocks.approveExecute).not.toHaveBeenCalled();
		expect(screen.getByText('Rescheduled. Nothing was sent.')).toBeTruthy();
	});

	it('requests regeneration without marking the draft sent', async () => {
		const { StepReviewActions } = await import('./step-review-actions');

		render(
			React.createElement(StepReviewActions, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
				draftText: 'Can we reconnect this week?',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
		expect(screen.getByText('Current draft stays in history. Nothing is sent.')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Confirm regenerate' }));

		expect(actionMocks.regenerateExecute).toHaveBeenCalledWith({
			stepId: '550e8400-e29b-41d4-a716-446655440003',
			followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
		});
		expect(actionMocks.approveExecute).not.toHaveBeenCalled();
		expect(screen.getByText('Regeneration queued. Nothing was sent.')).toBeTruthy();
	});
});

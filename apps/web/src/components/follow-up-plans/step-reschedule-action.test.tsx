import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
	rescheduleAction: vi.fn(),
	rescheduleExecute: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock('@/app/actions/follow-up-plans', () => ({
	rescheduleFollowUpPlanStepAction: actionMocks.rescheduleAction,
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: actionMocks.refresh }),
}));

vi.mock('next-safe-action/hooks', () => ({
	useAction: vi.fn((action: unknown) => {
		if (action === actionMocks.rescheduleAction) {
			return { execute: actionMocks.rescheduleExecute, isExecuting: false };
		}
		return { execute: vi.fn(), isExecuting: false };
	}),
}));

describe('StepRescheduleAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('React', React);
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-09T12:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('reschedules a step without recording a send', async () => {
		vi.stubGlobal(
			'prompt',
			vi.fn().mockReturnValueOnce('24').mockReturnValueOnce('Need fresh context tomorrow'),
		);
		const { StepRescheduleAction } = await import('./step-reschedule-action');

		render(
			React.createElement(StepRescheduleAction, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));

		expect(window.prompt).toHaveBeenNthCalledWith(
			1,
			'Reschedule this follow-up how many hours from now?',
			'24',
		);
		expect(window.prompt).toHaveBeenNthCalledWith(2, 'Optional reason for rescheduling:', '');
		expect(actionMocks.rescheduleExecute).toHaveBeenCalledWith({
			stepId: '550e8400-e29b-41d4-a716-446655440003',
			followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
			scheduledAt: '2026-06-10T12:00:00.000Z',
			reason: 'Need fresh context tomorrow',
		});
		expect(screen.getByText('Rescheduled. Nothing was sent.')).toBeTruthy();
	});

	it('rejects invalid reschedule intervals', async () => {
		vi.stubGlobal(
			'prompt',
			vi.fn(() => '0'),
		);
		const { StepRescheduleAction } = await import('./step-reschedule-action');

		render(
			React.createElement(StepRescheduleAction, {
				stepId: '550e8400-e29b-41d4-a716-446655440003',
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));

		expect(actionMocks.rescheduleExecute).not.toHaveBeenCalled();
		expect(screen.getByText('Enter a number of hours between 1 and 8760.')).toBeTruthy();
	});
});

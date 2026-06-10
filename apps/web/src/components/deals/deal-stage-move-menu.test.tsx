import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
	updateAction: vi.fn(),
	execute: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock('@/app/actions/deals', () => ({
	updateDealAction: actionMocks.updateAction,
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: actionMocks.refresh }),
}));

vi.mock('next-safe-action/hooks', () => ({
	useAction: vi.fn((action: unknown) => {
		if (action === actionMocks.updateAction) {
			return { execute: actionMocks.execute, isExecuting: false };
		}
		return { execute: vi.fn(), isExecuting: false };
	}),
}));

describe('DealStageMoveMenu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('React', React);
	});

	it('updates stage through the explicit keyboard-accessible select', async () => {
		const { DealStageMoveMenu } = await import('./deal-stage-move-menu');

		render(
			React.createElement(DealStageMoveMenu, {
				dealId: '550e8400-e29b-41d4-a716-446655440001',
				currentStage: 'discovery',
				label: 'Move stage for Test Deal',
			}),
		);

		fireEvent.change(screen.getByLabelText('Move stage for Test Deal'), {
			target: { value: 'diligence' },
		});

		expect(actionMocks.execute).toHaveBeenCalledWith({
			dealId: '550e8400-e29b-41d4-a716-446655440001',
			stage: 'diligence',
		});
	});

	it('does not call the action when the selected stage is unchanged', async () => {
		const { DealStageMoveMenu } = await import('./deal-stage-move-menu');

		render(
			React.createElement(DealStageMoveMenu, {
				dealId: '550e8400-e29b-41d4-a716-446655440001',
				currentStage: 'discovery',
			}),
		);

		fireEvent.change(screen.getByLabelText('Move deal stage'), {
			target: { value: 'discovery' },
		});

		expect(actionMocks.execute).not.toHaveBeenCalled();
	});
});

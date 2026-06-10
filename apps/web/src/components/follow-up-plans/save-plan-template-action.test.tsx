import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
	createTemplateFromPlan: vi.fn(() =>
		Promise.resolve({
			data: {
				id: 'local-template-from-plan',
				title: 'Plan template',
				version: 1,
				source: 'user',
				steps: [{ prompt: 'Plan prompt', delayHours: 24 }],
			},
		}),
	),
}));

vi.mock('@/app/actions/follow-up-plans', () => ({
	createFollowUpPlanTemplateFromPlanAction: actionMocks.createTemplateFromPlan,
}));

describe('SavePlanTemplateAction', () => {
	it('duplicates the plan as a local template without triggering plan actions', async () => {
		const { SavePlanTemplateAction } = await import('./save-plan-template-action');

		render(
			React.createElement(SavePlanTemplateAction, {
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));

		await waitFor(() => {
			expect(actionMocks.createTemplateFromPlan).toHaveBeenCalledWith({
				followUpPlanId: '550e8400-e29b-41d4-a716-446655440002',
			});
		});
		expect(await screen.findByText('Saved local template v1.')).toBeTruthy();
	});
});

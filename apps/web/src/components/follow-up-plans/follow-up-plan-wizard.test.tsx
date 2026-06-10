import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONTACT_ID = '550e8400-e29b-41d4-a716-446655440001';
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440002';
const GOAL_ID = '550e8400-e29b-41d4-a716-446655440003';

const actionMocks = vi.hoisted(() => ({
	listContactsAction: vi.fn(),
	listContactsExecute: vi.fn(),
	listContactsOnSuccess: undefined as undefined | ((result: unknown) => void),
	createPlan: vi.fn(() => Promise.resolve({ data: { id: PLAN_ID } })),
	activatePlan: vi.fn(() => Promise.resolve({ data: { id: PLAN_ID, status: 'active' } })),
	createTemplate: vi.fn(() =>
		Promise.resolve({
			data: {
				id: 'local-template-1',
				title: 'Edited VC Follow-up',
				description: 'Post-meeting follow-up sequence for investors',
				version: 1,
				source: 'user',
				category: 'Investor',
				steps: [{ prompt: 'Edited local prompt', delayHours: 48 }],
			},
		}),
	),
	createTemplateVersion: vi.fn(() =>
		Promise.resolve({
			data: {
				id: 'local-template-1',
				title: 'Local VC Follow-up v2',
				description: 'Personal investor sequence',
				version: 2,
				source: 'user',
				category: 'Investor',
				steps: [{ prompt: 'Updated local prompt', delayHours: 48 }],
			},
		}),
	),
	listTemplates: vi.fn(() =>
		Promise.resolve({
			data: [
				{
					id: 'vc-followup',
					title: 'VC Follow-up',
					description: 'Post-meeting follow-up sequence for investors',
					version: 2,
					source: 'built_in',
					category: 'Investor',
					steps: [{ prompt: 'Follow up with investor', delayHours: 24 }],
				},
			],
		}),
	),
	refresh: vi.fn(),
}));

vi.mock('@/app/actions/contacts', () => ({
	listContactsAction: actionMocks.listContactsAction,
}));

vi.mock('@/app/actions/follow-up-plans', () => ({
	createFollowUpPlanAction: actionMocks.createPlan,
	activateFollowUpPlanAction: actionMocks.activatePlan,
	createFollowUpPlanTemplateAction: actionMocks.createTemplate,
	createFollowUpPlanTemplateVersionAction: actionMocks.createTemplateVersion,
	getFollowUpPlanTemplatesAction: actionMocks.listTemplates,
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: actionMocks.refresh }),
}));

vi.mock('next-safe-action/hooks', () => ({
	useAction: vi.fn((_action: unknown, opts?: { onSuccess?: (result: unknown) => void }) => {
		actionMocks.listContactsOnSuccess = opts?.onSuccess;
		actionMocks.listContactsExecute.mockImplementation(() => {
			actionMocks.listContactsOnSuccess?.({
				data: [
					{
						id: CONTACT_ID,
						firstName: 'Ada',
						lastName: 'Lovelace',
					},
				],
			});
		});
		return {
			execute: actionMocks.listContactsExecute,
			isExecuting: false,
		};
	}),
}));

describe('FollowUpPlanWizardButton', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('React', React);
		actionMocks.listContactsOnSuccess = undefined;
	});

	it('saves a draft from a versioned built-in template without activating it', async () => {
		const { FollowUpPlanWizardButton } = await import('./follow-up-plan-wizard');

		render(
			React.createElement(FollowUpPlanWizardButton, {
				openOnMount: true,
				readiness: null,
			}),
		);

		expect(await screen.findByText('VC Follow-up')).toBeTruthy();
		expect(screen.getByRole('dialog', { name: 'Choose Template' }).className).toContain(
			'max-h-[calc(100vh-2rem)]',
		);
		expect(screen.getByText('Investor · Built-in v2 · 1 steps')).toBeTruthy();

		fireEvent.click(screen.getByText('VC Follow-up'));
		fireEvent.change(screen.getByLabelText('Contact'), {
			target: { value: CONTACT_ID },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

		await waitFor(() => {
			expect(actionMocks.createPlan).toHaveBeenCalledWith(
				expect.objectContaining({
					contactId: CONTACT_ID,
					templateId: 'vc-followup',
					templateVersion: 2,
					templateSource: 'built_in',
					steps: [{ prompt: 'Follow up with investor', delayHours: 24 }],
					config: expect.objectContaining({
						sendingMode: 'manual',
					}),
				}),
			);
		});
		expect(actionMocks.activatePlan).not.toHaveBeenCalled();
	});

	it('stores a linked goal when creating from a goal outreach suggestion', async () => {
		const { FollowUpPlanWizardButton } = await import('./follow-up-plan-wizard');

		render(
			React.createElement(FollowUpPlanWizardButton, {
				initialContactId: CONTACT_ID,
				initialGoalId: GOAL_ID,
				initialGoalTitle: 'Win three founder introductions',
				openOnMount: true,
				readiness: null,
			}),
		);

		fireEvent.click(await screen.findByText('VC Follow-up'));

		expect(screen.getByText('Linked goal:')).toBeTruthy();
		expect(screen.getByText('Win three founder introductions')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

		await waitFor(() => {
			expect(actionMocks.createPlan).toHaveBeenCalledWith(
				expect.objectContaining({
					contactId: CONTACT_ID,
					config: expect.objectContaining({
						objective: 'Support goal: Win three founder introductions',
						sourceGoalId: GOAL_ID,
					}),
				}),
			);
		});
		expect(actionMocks.activatePlan).not.toHaveBeenCalled();
	});

	it('saves edited template steps as an encrypted local template copy', async () => {
		const { FollowUpPlanWizardButton } = await import('./follow-up-plan-wizard');

		render(
			React.createElement(FollowUpPlanWizardButton, {
				openOnMount: true,
				readiness: null,
			}),
		);

		fireEvent.click(await screen.findByText('VC Follow-up'));
		fireEvent.change(screen.getByLabelText('Title'), {
			target: { value: 'Edited VC Follow-up' },
		});
		fireEvent.change(screen.getByLabelText('Step 1 prompt'), {
			target: { value: 'Edited local prompt' },
		});
		fireEvent.change(screen.getByLabelText('Step 1 delay hours'), {
			target: { value: '48' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save as local template' }));

		await waitFor(() => {
			expect(actionMocks.createTemplate).toHaveBeenCalledWith({
				title: 'Edited VC Follow-up',
				description: 'Post-meeting follow-up sequence for investors',
				category: 'Investor',
				steps: [{ prompt: 'Edited local prompt', delayHours: 48 }],
			});
		});
		expect(actionMocks.createPlan).not.toHaveBeenCalled();
		expect(actionMocks.activatePlan).not.toHaveBeenCalled();
		expect(await screen.findByText('Saved as a local template copy.')).toBeTruthy();
	});

	it('saves edits to an existing local template as a new version', async () => {
		actionMocks.listTemplates.mockResolvedValueOnce({
			data: [
				{
					id: 'local-template-1',
					title: 'Local VC Follow-up',
					description: 'Personal investor sequence',
					version: 1,
					source: 'user',
					category: 'Investor',
					steps: [{ prompt: 'Local prompt', delayHours: 24 }],
				},
			],
		});
		const { FollowUpPlanWizardButton } = await import('./follow-up-plan-wizard');

		render(
			React.createElement(FollowUpPlanWizardButton, {
				openOnMount: true,
				readiness: null,
			}),
		);

		expect(await screen.findByText('Investor · Local v1 · 1 steps')).toBeTruthy();
		fireEvent.click(screen.getByText('Local VC Follow-up'));
		fireEvent.change(screen.getByLabelText('Title'), {
			target: { value: 'Local VC Follow-up v2' },
		});
		fireEvent.change(screen.getByLabelText('Step 1 prompt'), {
			target: { value: 'Updated local prompt' },
		});
		fireEvent.change(screen.getByLabelText('Step 1 delay hours'), {
			target: { value: '48' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save new version' }));

		await waitFor(() => {
			expect(actionMocks.createTemplateVersion).toHaveBeenCalledWith({
				templateId: 'local-template-1',
				title: 'Local VC Follow-up v2',
				description: 'Personal investor sequence',
				category: 'Investor',
				steps: [{ prompt: 'Updated local prompt', delayHours: 48 }],
			});
		});
		expect(actionMocks.createTemplate).not.toHaveBeenCalled();
		expect(actionMocks.createPlan).not.toHaveBeenCalled();
		expect(actionMocks.activatePlan).not.toHaveBeenCalled();
		expect(await screen.findByText('Saved as local template v2.')).toBeTruthy();
	});
});

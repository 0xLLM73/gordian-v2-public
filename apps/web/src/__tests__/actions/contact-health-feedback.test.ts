import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(() =>
				Promise.resolve({
					user: { id: '550e8400-e29b-41d4-a716-446655440002' },
					session: { id: 'session-1' },
				}),
			),
		},
	},
}));

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '550e8400-e29b-41d4-a716-446655440001';
const USER_ID = '550e8400-e29b-41d4-a716-446655440002';
const mockRecordContactHealthFeedback = vi.fn(() => Promise.resolve({ id: 'feedback-1' }));
const callMockRecordContactHealthFeedback = mockRecordContactHealthFeedback as unknown as (
	workspaceId: unknown,
	input: unknown,
) => unknown;

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
	),
}));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	CONTACT_HEALTH_FEEDBACK_ACTIONS: [
		'snooze',
		'mark_low_touch',
		'handled_elsewhere',
		'not_important',
		'dismiss_wrong',
	],
	CONTACT_HEALTH_FEEDBACK_REASONS: [
		'snoozed',
		'normal_low_touch',
		'talked_elsewhere',
		'not_important',
		'wrong_alert',
	],
	recordContactHealthFeedback: (workspaceId: unknown, input: unknown) =>
		callMockRecordContactHealthFeedback(workspaceId, input),
}));

describe('contact health feedback action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('records default 30-day snooze feedback in the current workspace', async () => {
		const { recordContactHealthFeedbackAction } = await import(
			'@/app/actions/contact-health-feedback'
		);

		const before = Date.now();
		const result = await recordContactHealthFeedbackAction({
			contactId: CONTACT_ID,
			action: 'snooze',
			statusReasonCode: 'gap_longer_than_usual',
		});
		const after = Date.now();

		expect(result?.data).toEqual({ id: 'feedback-1' });
		expect(mockRecordContactHealthFeedback).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				contactId: CONTACT_ID,
				action: 'snooze',
				reason: 'snoozed',
				statusReasonCode: 'gap_longer_than_usual',
				userId: USER_ID,
				metadata: { source: 'dashboard' },
			}),
		);
		const firstCall = mockRecordContactHealthFeedback.mock.calls[0] as unknown[] | undefined;
		const input = firstCall?.[1] as {
			snoozedUntil: Date;
		};
		expect(input.snoozedUntil.getTime()).toBeGreaterThan(before + 29 * 86400000);
		expect(input.snoozedUntil.getTime()).toBeLessThan(after + 31 * 86400000);
	});

	it('defaults low-touch feedback to a structured reason code', async () => {
		const { recordContactHealthFeedbackAction } = await import(
			'@/app/actions/contact-health-feedback'
		);

		await recordContactHealthFeedbackAction({
			contactId: CONTACT_ID,
			action: 'mark_low_touch',
		});

		expect(mockRecordContactHealthFeedback).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				action: 'mark_low_touch',
				reason: 'normal_low_touch',
				snoozedUntil: null,
			}),
		);
	});

	it('rejects past snooze dates before writing feedback', async () => {
		const { recordContactHealthFeedbackAction } = await import(
			'@/app/actions/contact-health-feedback'
		);

		const result = await recordContactHealthFeedbackAction({
			contactId: CONTACT_ID,
			action: 'snooze',
			snoozedUntil: new Date(Date.now() - 1000).toISOString(),
		});

		expect(result?.serverError).toBe('Snooze must be in the future');
		expect(mockRecordContactHealthFeedback).not.toHaveBeenCalled();
	});
});

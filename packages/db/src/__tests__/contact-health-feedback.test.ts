import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLimit = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit, orderBy: mockOrderBy })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));
const mockReturning = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn(() => ({ returning: mockReturning })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockValues })));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		select: mockSelect,
	},
}));

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '550e8400-e29b-41d4-a716-446655440001';
const USER_ID = '550e8400-e29b-41d4-a716-446655440002';

describe('contact health feedback DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLimit.mockResolvedValue([{ id: CONTACT_ID }]);
		mockReturning.mockResolvedValue([]);
		mockOrderBy.mockResolvedValue([]);
	});

	it('records structured feedback after verifying workspace contact ownership', async () => {
		const { recordContactHealthFeedback } = await import('../dal/contact-health-feedback');
		const snoozedUntil = new Date(Date.now() + 7 * 86400000);
		const row = { id: 'feedback-1', contactId: CONTACT_ID, action: 'snooze' };
		mockReturning.mockResolvedValueOnce([row]);

		const result = await recordContactHealthFeedback(WORKSPACE_ID, {
			action: 'snooze',
			contactId: CONTACT_ID,
			reason: 'snoozed',
			snoozedUntil,
			statusReasonCode: 'gap_longer_than_usual',
			userId: USER_ID,
		});

		expect(result).toBe(row);
		expect(mockLimit).toHaveBeenCalledWith(1);
		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WORKSPACE_ID,
				contactId: CONTACT_ID,
				userId: USER_ID,
				action: 'snooze',
				reason: 'snoozed',
				statusReasonCode: 'gap_longer_than_usual',
				snoozedUntil,
				metadata: {},
			}),
		);
	});

	it('rejects feedback for contacts outside the workspace', async () => {
		const { recordContactHealthFeedback } = await import('../dal/contact-health-feedback');
		mockLimit.mockResolvedValueOnce([]);

		await expect(
			recordContactHealthFeedback(WORKSPACE_ID, {
				action: 'not_important',
				contactId: CONTACT_ID,
				reason: 'not_important',
				userId: USER_ID,
			}),
		).rejects.toThrow('Not found');

		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('rejects snoozes that are not in the future', async () => {
		const { recordContactHealthFeedback } = await import('../dal/contact-health-feedback');

		await expect(
			recordContactHealthFeedback(WORKSPACE_ID, {
				action: 'snooze',
				contactId: CONTACT_ID,
				reason: 'snoozed',
				snoozedUntil: new Date(Date.now() - 1000),
				userId: USER_ID,
			}),
		).rejects.toThrow('Snooze must be in the future');

		expect(mockSelect).not.toHaveBeenCalled();
	});

	it('skips active feedback lookup when no contacts are provided', async () => {
		const { getActiveContactHealthFeedback } = await import('../dal/contact-health-feedback');

		await expect(getActiveContactHealthFeedback(WORKSPACE_ID, [])).resolves.toEqual([]);
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it('fetches active feedback for explicit contacts newest first', async () => {
		const { getActiveContactHealthFeedback } = await import('../dal/contact-health-feedback');
		const rows = [{ contactId: CONTACT_ID, action: 'mark_low_touch' }];
		mockOrderBy.mockResolvedValueOnce(rows);

		const result = await getActiveContactHealthFeedback(WORKSPACE_ID, [CONTACT_ID]);

		expect(result).toBe(rows);
		expect(mockWhere).toHaveBeenCalledTimes(1);
		expect(mockOrderBy).toHaveBeenCalledTimes(1);
	});
});

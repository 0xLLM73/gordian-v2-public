import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB client — chain: insert().values().returning()
//                         update().set().where()
//                         select().from().where().orderBy().limit()
const mockReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockUpdateWhere = vi.fn(() => Promise.resolve());
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

const mockLimit = vi.fn(() => Promise.resolve([] as unknown[]));
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
}));

const mockEnvelope = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: 'ws-1' },
	wrkVersion: 1,
};

const WORKSPACE_ID = 'ws-1';
const USER_ID = 'user-1';
const BRIEF_ID = '660e8400-e29b-41d4-a716-446655440001';

describe('briefs DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('saveBrief', () => {
		it('inserts brief with correct values and returns ID', async () => {
			mockReturning.mockResolvedValue([{ id: BRIEF_ID }]);

			const { saveBrief } = await import('../dal/briefs');
			const result = await saveBrief(
				WORKSPACE_ID,
				USER_ID,
				{
					text: 'Good morning! Here is your brief.',
					toneTraceId: '770e8400-e29b-41d4-a716-446655440002',
					detailTraceId: '880e8400-e29b-41d4-a716-446655440003',
					toneVariant: 'brief_tone_casual',
					detailVariant: 'brief_detail_low',
				},
				mockEnvelope,
			);

			expect(mockInsert).toHaveBeenCalled();
			expect(mockInsertValues).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId: WORKSPACE_ID,
					userId: USER_ID,
					content: 'Good morning! Here is your brief.',
					toneVariant: 'brief_tone_casual',
					detailVariant: 'brief_detail_low',
				}),
			);
			expect(result).toBe(BRIEF_ID);
		});

		it('throws when insert returns empty rows', async () => {
			mockReturning.mockResolvedValue([]);

			const { saveBrief } = await import('../dal/briefs');
			await expect(
				saveBrief(
					WORKSPACE_ID,
					USER_ID,
					{
						text: 'Brief text',
						toneTraceId: '770e8400-e29b-41d4-a716-446655440002',
						detailTraceId: '880e8400-e29b-41d4-a716-446655440003',
						toneVariant: 'brief_tone_formal',
						detailVariant: 'brief_detail_high',
					},
					mockEnvelope,
				),
			).rejects.toThrow('Failed to insert brief');
		});
	});

	describe('getLatestBrief', () => {
		it('returns the most recent brief for a user', async () => {
			const mockRow = {
				id: BRIEF_ID,
				content: 'Morning brief content',
				toneTraceId: '770e8400-e29b-41d4-a716-446655440002',
				detailTraceId: '880e8400-e29b-41d4-a716-446655440003',
				toneVariant: 'brief_tone_casual',
				detailVariant: 'brief_detail_low',
				feedback: null,
				generatedAt: new Date('2026-02-23T08:00:00Z'),
			};
			mockLimit.mockResolvedValue([mockRow]);

			const { getLatestBrief } = await import('../dal/briefs');
			const result = await getLatestBrief(WORKSPACE_ID, USER_ID, mockEnvelope);

			expect(mockSelect).toHaveBeenCalled();
			expect(result).not.toBeNull();
			expect(result?.id).toBe(BRIEF_ID);
			expect(result?.content).toBe('Morning brief content');
			expect(result?.toneVariant).toBe('brief_tone_casual');
			expect(result?.feedback).toBeNull();
		});

		it('returns null when no brief exists for the user', async () => {
			mockLimit.mockResolvedValue([]);

			const { getLatestBrief } = await import('../dal/briefs');
			const result = await getLatestBrief(WORKSPACE_ID, USER_ID, mockEnvelope);

			expect(result).toBeNull();
		});
	});

	describe('updateBriefFeedback', () => {
		it('updates feedback and feedbackAt for the brief', async () => {
			const { updateBriefFeedback } = await import('../dal/briefs');
			await updateBriefFeedback(BRIEF_ID, WORKSPACE_ID, true);

			expect(mockUpdate).toHaveBeenCalled();
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					feedback: true,
					feedbackAt: expect.any(Date),
				}),
			);
			expect(mockUpdateWhere).toHaveBeenCalled();
		});

		it('sets feedback to false for not_helpful reaction', async () => {
			const { updateBriefFeedback } = await import('../dal/briefs');
			await updateBriefFeedback(BRIEF_ID, WORKSPACE_ID, false);

			expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ feedback: false }));
		});
	});
});

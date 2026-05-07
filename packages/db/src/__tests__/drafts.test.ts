import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB client
const mockReturning = vi.fn();
const mockSet = vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) }));
const mockWhere = vi.fn(() => ({
	limit: vi.fn(() => Promise.resolve([])),
	returning: mockReturning,
}));
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockSelect = vi.fn(() => ({ from: vi.fn(() => ({ where: mockWhere })) }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope, fn) => fn()),
}));

const mockEnvelope = {
	encryptedWrk: Buffer.from('test'),
	kmsContext: { workspaceId: 'ws-1' },
	wrkVersion: 1,
};

describe('drafts DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('createDraftLog calls insert with correct values', async () => {
		const mockDraft = { id: 'draft-1', workspaceId: 'ws-1', contactId: 'contact-1' };
		mockReturning.mockResolvedValue([mockDraft]);

		const { createDraftLog } = await import('../dal/drafts');
		const result = await createDraftLog(
			'ws-1',
			'contact-1',
			'casual_nudge',
			'Hey, how are you?',
			mockEnvelope,
		);

		expect(mockInsert).toHaveBeenCalled();
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				contactId: 'contact-1',
				armType: 'casual_nudge',
				generatedText: 'Hey, how are you?',
			}),
		);
		expect(result).toEqual(mockDraft);
	});

	it('getDraftLog returns null for non-existent ID', async () => {
		mockWhere.mockReturnValue({
			limit: vi.fn(() => Promise.resolve([])),
			returning: mockReturning,
		});

		const { getDraftLog } = await import('../dal/drafts');
		const result = await getDraftLog('ws-1', 'non-existent', mockEnvelope);

		expect(result).toBeNull();
	});

	it('markDraftSent sets wasSent: true and sentAt', async () => {
		const mockSent = { id: 'draft-1', wasSent: true, sentAt: new Date() };
		mockReturning.mockResolvedValue([mockSent]);

		const { markDraftSent } = await import('../dal/drafts');
		const result = await markDraftSent('ws-1', 'draft-1', 'Edited text', 5, mockEnvelope);

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({
				wasSent: true,
				editedText: 'Edited text',
				editDistance: 5,
			}),
		);
		expect(result).toEqual(mockSent);
	});

	it('markDraftDiscarded sets wasDiscarded: true', async () => {
		const mockDiscarded = { id: 'draft-1', wasDiscarded: true };
		mockReturning.mockResolvedValue([mockDiscarded]);

		const { markDraftDiscarded } = await import('../dal/drafts');
		const result = await markDraftDiscarded('ws-1', 'draft-1');

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ wasDiscarded: true }));
		expect(result).toEqual(mockDiscarded);
	});
});

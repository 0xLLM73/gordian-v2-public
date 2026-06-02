import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAnd = vi.hoisted(() => vi.fn((...conditions: unknown[]) => ({ conditions })));
const mockEq = vi.hoisted(() => vi.fn((field: unknown, value: unknown) => ({ field, value })));

const mockInsert = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());
const mockLeftJoin = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockLimit = vi.hoisted(() => vi.fn());
const mockWithKeys = vi.hoisted(() => vi.fn());

vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	return {
		...actual,
		and: mockAnd,
		eq: mockEq,
	};
});

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		select: mockSelect,
	},
}));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
	keyStore: { getStore: vi.fn(() => null) },
	encrypt: vi.fn((value: string) => `enc:${value}`),
	decrypt: vi.fn((value: string) => value),
	computeBlindIndex: vi.fn((value: string) => `bidx:${value}`),
}));

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const CONTACT_ID = '33333333-3333-3333-3333-333333333333';
const MOCK_ENVELOPE = { encryptedWrk: Buffer.from('test'), kmsContext: {}, wrkVersion: 1 };

const mockCommitment = {
	id: '44444444-4444-4444-4444-444444444444',
	workspaceId: WORKSPACE_ID,
	contactId: CONTACT_ID,
	title: 'Send the deck',
	commitmentType: 'task',
	status: 'draft',
	assignee: 'user',
	confidence: 0.8,
};

describe('createCommitment', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mockWithKeys.mockImplementation((_envelope: unknown, fn: () => unknown) => fn());
		mockLimit.mockResolvedValue([{ id: CONTACT_ID }]);
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
		mockLeftJoin.mockReturnValue({ where: mockWhere });
		mockFrom.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
		mockReturning.mockResolvedValue([mockCommitment]);
		mockValues.mockReturnValue({ returning: mockReturning });
		mockInsert.mockReturnValue({ values: mockValues });
	});

	it('checks the contact belongs to the same workspace before insert', async () => {
		const { contacts } = await import('../schema/contacts');
		const { createCommitment } = await import('../dal/commitments');

		await createCommitment(
			WORKSPACE_ID,
			{
				contactId: CONTACT_ID,
				title: 'Send the deck',
				commitmentType: 'task',
				assignee: 'user',
				confidence: 0.8,
			},
			MOCK_ENVELOPE,
		);

		expect(mockEq).toHaveBeenCalledWith(contacts.id, CONTACT_ID);
		expect(mockEq).toHaveBeenCalledWith(contacts.workspaceId, WORKSPACE_ID);
		expect(mockInsert).toHaveBeenCalledOnce();
	});

	it('returns null and skips insert when the contact is not workspace-owned', async () => {
		const { createCommitment } = await import('../dal/commitments');
		mockLimit.mockResolvedValueOnce([]);

		const result = await createCommitment(
			OTHER_WORKSPACE_ID,
			{
				contactId: CONTACT_ID,
				title: 'Send the deck',
				commitmentType: 'task',
				assignee: 'user',
				confidence: 0.8,
			},
			MOCK_ENVELOPE,
		);

		expect(result).toBeNull();
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('still inserts valid same-workspace commitments with confidence-derived status', async () => {
		const { createCommitment } = await import('../dal/commitments');

		const result = await createCommitment(
			WORKSPACE_ID,
			{
				contactId: CONTACT_ID,
				title: 'Wire funds',
				commitmentType: 'financial',
				assignee: 'contact',
				confidence: 0.9,
			},
			MOCK_ENVELOPE,
		);

		expect(result).toEqual(mockCommitment);
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: WORKSPACE_ID,
				contactId: CONTACT_ID,
				status: 'active',
				title: 'Wire funds',
			}),
		);
	});

	it('allows local extraction to force draft status and store source message ids', async () => {
		const { createCommitment } = await import('../dal/commitments');

		await createCommitment(
			WORKSPACE_ID,
			{
				contactId: CONTACT_ID,
				title: 'Send the deck',
				commitmentType: 'task',
				assignee: 'user',
				confidence: 0.95,
				status: 'draft',
				sourceMessageIds: ['55555555-5555-4555-8555-555555555555'],
			},
			MOCK_ENVELOPE,
		);

		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'draft',
				sourceMessageIds: ['55555555-5555-4555-8555-555555555555'],
			}),
		);
	});

	it('returns safe display attribution fields for First Look commitments', async () => {
		const { contacts } = await import('../schema/contacts');
		const { commitments } = await import('../schema/commitments');
		const { getCommitmentsForFirstLook } = await import('../dal/commitments');

		await getCommitmentsForFirstLook(WORKSPACE_ID, MOCK_ENVELOPE, {
			limit: 5,
			maxAgeDays: 14,
		});

		const selection = mockSelect.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(selection).toEqual(
			expect.objectContaining({
				assignee: commitments.assignee,
				quote: commitments.quote,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
			}),
		);
		expect(selection).not.toHaveProperty('extractionContext');
		expect(selection).not.toHaveProperty('embedding');
		expect(selection).not.toHaveProperty('banditTraceId');
		expect(mockLeftJoin).toHaveBeenCalled();
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(() =>
				Promise.resolve({
					user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
					session: { id: 'session-1' },
				}),
			),
		},
	},
}));

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '550e8400-e29b-41d4-a716-446655440001';
const DEAL_ID = '550e8400-e29b-41d4-a716-446655440002';

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

const mockCreate = vi.fn(() =>
	Promise.resolve({
		id: DEAL_ID,
		title: 'SAFT Round',
		stage: 'discovery',
		dealType: 'investment',
		value: 500000,
	}),
);
const mockList = vi.fn(() =>
	Promise.resolve([
		{
			id: DEAL_ID,
			title: 'SAFT Round',
			stage: 'discovery',
			dealType: 'investment',
			value: 500000,
		},
	]),
);
const mockUpdate = vi.fn(() =>
	Promise.resolve({
		id: DEAL_ID,
		title: 'SAFT Round',
		stage: 'negotiation',
		dealType: 'investment',
		value: 500000,
	}),
);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	createDeal: mockCreate,
	listDeals: mockList,
	updateDeal: mockUpdate,
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

describe('deal actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('listDealsAction', () => {
		it('lists deals without filters', async () => {
			const { listDealsAction } = await import('@/app/actions/deals');
			const result = await listDealsAction({});
			expect(result?.data).toBeDefined();
			expect(mockList).toHaveBeenCalledWith(WORKSPACE_ID, expect.any(Object), {
				stage: undefined,
				limit: undefined,
				offset: undefined,
			});
		});

		it('accepts stage filter', async () => {
			const { listDealsAction } = await import('@/app/actions/deals');
			const result = await listDealsAction({ stage: 'negotiation' });
			expect(result?.data).toBeDefined();
			expect(mockList).toHaveBeenCalledWith(WORKSPACE_ID, expect.any(Object), {
				stage: 'negotiation',
				limit: undefined,
				offset: undefined,
			});
		});

		it('rejects invalid stage value', async () => {
			const { listDealsAction } = await import('@/app/actions/deals');
			const result = await listDealsAction({
				// @ts-expect-error testing invalid input
				stage: 'invalid-stage',
			});
			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('createDealAction', () => {
		it('creates a deal with required fields', async () => {
			const { createDealAction } = await import('@/app/actions/deals');
			const result = await createDealAction({
				contactId: CONTACT_ID,
				title: 'SAFT Round',
				value: 500000,
			});
			expect(result?.data).toBeDefined();
			expect(mockCreate).toHaveBeenCalledWith(
				WORKSPACE_ID,
				{
					contactId: CONTACT_ID,
					title: 'SAFT Round',
					value: 500000,
					dealType: undefined,
					notes: undefined,
					terms: undefined,
				},
				expect.any(Object), // envelope
			);
		});

		it('creates a deal with all optional fields', async () => {
			const { createDealAction } = await import('@/app/actions/deals');
			const result = await createDealAction({
				contactId: CONTACT_ID,
				title: 'Token Warrant',
				dealType: 'token',
				value: 100000,
				notes: 'Series A',
				terms: { discount: 20, vestingCliffMonths: 12 },
			});
			expect(result?.data).toBeDefined();
			expect(mockCreate).toHaveBeenCalledWith(
				WORKSPACE_ID,
				{
					contactId: CONTACT_ID,
					title: 'Token Warrant',
					dealType: 'token',
					value: 100000,
					notes: 'Series A',
					terms: { discount: 20, vestingCliffMonths: 12 },
				},
				expect.any(Object), // envelope
			);
		});

		it('allows value of 0 (advisory/partnership deals)', async () => {
			const { createDealAction } = await import('@/app/actions/deals');
			const result = await createDealAction({
				contactId: CONTACT_ID,
				title: 'Advisory Agreement',
				value: 0,
			});
			expect(result?.data).toBeDefined();
		});
	});

	describe('updateDealAction', () => {
		it('updates deal stage', async () => {
			const { updateDealAction } = await import('@/app/actions/deals');
			const result = await updateDealAction({
				dealId: DEAL_ID,
				stage: 'negotiation',
			});
			expect(result?.data).toBeDefined();
			expect(mockUpdate).toHaveBeenCalledWith(
				WORKSPACE_ID,
				DEAL_ID,
				{
					title: undefined,
					stage: 'negotiation',
					dealType: undefined,
					value: undefined,
					notes: undefined,
					terms: undefined,
				},
				expect.any(Object), // envelope
			);
		});

		it('updates deal type and terms', async () => {
			const { updateDealAction } = await import('@/app/actions/deals');
			const result = await updateDealAction({
				dealId: DEAL_ID,
				dealType: 'investment',
				terms: { discount: 25, proRataRights: true },
			});
			expect(result?.data).toBeDefined();
			expect(mockUpdate).toHaveBeenCalledWith(
				WORKSPACE_ID,
				DEAL_ID,
				{
					title: undefined,
					stage: undefined,
					dealType: 'investment',
					value: undefined,
					notes: undefined,
					terms: { discount: 25, proRataRights: true },
				},
				expect.any(Object), // envelope
			);
		});

		it('rejects invalid deal type', async () => {
			const { updateDealAction } = await import('@/app/actions/deals');
			const result = await updateDealAction({
				dealId: DEAL_ID,
				// @ts-expect-error testing invalid input
				dealType: 'bogus',
			});
			expect(result?.validationErrors).toBeDefined();
		});
	});
});

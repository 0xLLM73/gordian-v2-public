import { _resetForTesting as resetRateLimit } from '@/lib/rate-limit';
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

const mockGetActive = vi.fn(() =>
	Promise.resolve([{ id: 'c1', title: 'Follow up', status: 'active', confidence: 0.9 }]),
);
const mockGetByContact = vi.fn(() => Promise.resolve([]));
const mockUpdateStatus = vi.fn(() =>
	Promise.resolve({
		id: 'c1',
		status: 'completed',
		banditTraceId: 'trace-1' as string | null,
		contactId: 'contact-1',
	}),
);
const mockMarkFulfilled = vi.fn(() =>
	Promise.resolve({ id: 'c1', status: 'completed', banditTraceId: 'trace-1' as string | null }),
);
const mockFinalizeBanditReward = vi.fn().mockResolvedValue(null);
const mockCreateGoldenExample = vi.fn().mockResolvedValue({ id: 'golden-1' });
const mockCreateCorrectionDiff = vi.fn().mockResolvedValue(null);
const mockGetCommitmentForFeedback = vi.fn().mockResolvedValue({
	id: 'c1',
	title: 'Follow up',
	commitmentType: 'promise',
	assignee: 'user',
	confidence: 0.9,
	extractionContext: 'test context',
	quote: 'test quote',
});

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getActiveCommitments: mockGetActive,
	getCommitmentsByContact: mockGetByContact,
	updateCommitmentStatus: mockUpdateStatus,
	markCommitmentFulfilled: mockMarkFulfilled,
	getCommitmentForFeedback: mockGetCommitmentForFeedback,
	createGoldenExample: mockCreateGoldenExample,
	createCorrectionDiff: mockCreateCorrectionDiff,
	finalizeBanditReward: mockFinalizeBanditReward,
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

describe('commitment actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetRateLimit();
	});

	describe('getActiveCommitmentsAction', () => {
		it('fetches active commitments', async () => {
			const { getActiveCommitmentsAction } = await import('@/app/actions/commitments');

			const result = await getActiveCommitmentsAction({});

			expect(result?.data).toBeDefined();
			expect(mockGetActive).toHaveBeenCalled();
		});

		it('accepts optional limit', async () => {
			const { getActiveCommitmentsAction } = await import('@/app/actions/commitments');

			const result = await getActiveCommitmentsAction({
				limit: 5,
			});

			expect(result?.data).toBeDefined();
		});
	});

	describe('getCommitmentsByContactAction', () => {
		it('fetches commitments for a contact', async () => {
			const { getCommitmentsByContactAction } = await import('@/app/actions/commitments');

			const result = await getCommitmentsByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.data).toBeDefined();
			expect(mockGetByContact).toHaveBeenCalled();
		});

		it('accepts status filter', async () => {
			const { getCommitmentsByContactAction } = await import('@/app/actions/commitments');

			const result = await getCommitmentsByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
				status: 'active',
			});

			expect(result?.data).toBeDefined();
		});

		it('rejects invalid status value', async () => {
			const { getCommitmentsByContactAction } = await import('@/app/actions/commitments');

			const result = await getCommitmentsByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
				// @ts-expect-error testing invalid input
				status: 'invalid-status',
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});

	describe('updateCommitmentStatusAction', () => {
		it('updates status to completed', async () => {
			const { updateCommitmentStatusAction } = await import('@/app/actions/commitments');

			const result = await updateCommitmentStatusAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
				status: 'completed',
			});

			expect(result?.data).toBeDefined();
			expect(mockUpdateStatus).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				'completed',
			);
		});

		it('updates status to dismissed', async () => {
			const { updateCommitmentStatusAction } = await import('@/app/actions/commitments');

			await updateCommitmentStatusAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
				status: 'dismissed',
			});

			expect(mockUpdateStatus).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(String),
				'dismissed',
			);
		});
	});

	describe('confirmCommitmentAction', () => {
		it('sets status to active and sends positive bandit reward', async () => {
			const { confirmCommitmentAction } = await import('@/app/actions/commitments');

			const result = await confirmCommitmentAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockUpdateStatus).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				'active',
			);
			expect(mockFinalizeBanditReward).toHaveBeenCalledWith('trace-1', 1.0);
		});

		it('skips bandit reward when no traceId', async () => {
			mockUpdateStatus.mockResolvedValueOnce({
				id: 'c1',
				status: 'active',
				banditTraceId: null,
				contactId: 'contact-1',
			});
			const { confirmCommitmentAction } = await import('@/app/actions/commitments');

			await confirmCommitmentAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(mockFinalizeBanditReward).not.toHaveBeenCalled();
		});
	});

	describe('dismissCommitmentAction', () => {
		it('does nothing for still_pending reason', async () => {
			const { dismissCommitmentAction } = await import('@/app/actions/commitments');

			const result = await dismissCommitmentAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
				reason: 'still_pending',
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockUpdateStatus).not.toHaveBeenCalled();
			expect(mockMarkFulfilled).not.toHaveBeenCalled();
			expect(mockFinalizeBanditReward).not.toHaveBeenCalled();
		});

		it('marks fulfilled with positive reward for already_done', async () => {
			const { dismissCommitmentAction } = await import('@/app/actions/commitments');

			const result = await dismissCommitmentAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
				reason: 'already_done',
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockMarkFulfilled).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				'User confirmed during First Look review',
				expect.objectContaining({ encryptedWrk: expect.any(Buffer) }),
			);
			expect(mockFinalizeBanditReward).toHaveBeenCalledWith('trace-1', 1.0);
		});

		it('dismisses with negative reward and creates correction diff for not_real', async () => {
			const { dismissCommitmentAction } = await import('@/app/actions/commitments');

			const result = await dismissCommitmentAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
				reason: 'not_real',
			});

			expect(result?.data).toEqual({ success: true });
			expect(mockUpdateStatus).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				'dismissed',
			);
			expect(mockFinalizeBanditReward).toHaveBeenCalledWith('trace-1', 0.0);
		});

		it('rejects invalid reason', async () => {
			const { dismissCommitmentAction } = await import('@/app/actions/commitments');

			const result = await dismissCommitmentAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
				// @ts-expect-error testing invalid input
				reason: 'bad_reason',
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});
});

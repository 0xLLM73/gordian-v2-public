import { _resetForTesting as resetRateLimit } from '@/lib/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const SENSITIVE_COMMITMENT_FIELDS = [
	'extractionContext',
	'embedding',
	'banditTraceId',
	'fulfillmentEvidence',
	'lastCheckedAt',
] as const;
type MockDbRow = Record<string, unknown>;

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

const mockCommitmentRow = {
	id: 'c1',
	contactId: 'contact-1',
	title: 'Follow up',
	commitmentType: 'task',
	status: 'active',
	assignee: 'user',
	confidence: 0.9,
	dueDate: null,
	quote: 'test quote',
	fulfilledAt: null,
	snoozedUntil: null,
	createdAt: new Date('2026-05-01T12:00:00.000Z'),
	updatedAt: new Date('2026-05-01T12:00:00.000Z'),
	contactFirstName: 'Ada',
	contactLastName: 'Lovelace',
	sourceMessageAgeDays: 1,
	extractionContext: 'private extraction context',
	embedding: [0.1, 0.2, 0.3],
	banditTraceId: 'trace-1',
	fulfillmentEvidence: 'private fulfillment evidence',
	lastCheckedAt: new Date('2026-05-02T12:00:00.000Z'),
};

const mockGetActive = vi.fn<(...args: unknown[]) => Promise<MockDbRow[]>>(() =>
	Promise.resolve([mockCommitmentRow]),
);
const mockGetFirstLook = vi.fn<(...args: unknown[]) => Promise<MockDbRow[]>>(() =>
	Promise.resolve([
		mockCommitmentRow,
		{ ...mockCommitmentRow, id: 'c2', status: 'draft', confidence: 0.62 },
	]),
);
const mockGetByContact = vi.fn<(...args: unknown[]) => Promise<MockDbRow[]>>(() =>
	Promise.resolve([]),
);
const mockUpdateStatus = vi.fn<(...args: unknown[]) => Promise<MockDbRow | null>>(() =>
	Promise.resolve({
		id: 'c1',
		status: 'completed',
		banditTraceId: 'trace-1' as string | null,
		contactId: 'contact-1',
		extractionContext: 'private extraction context',
		embedding: [0.1, 0.2, 0.3],
		fulfillmentEvidence: 'private fulfillment evidence',
		lastCheckedAt: new Date('2026-05-02T12:00:00.000Z'),
	}),
);
const mockSnoozeCommitment = vi.fn<(...args: unknown[]) => Promise<MockDbRow | null>>(() =>
	Promise.resolve({
		...mockCommitmentRow,
		snoozedUntil: new Date('2099-05-03T12:00:00.000Z'),
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
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getActiveCommitments: mockGetActive,
	getCommitmentsForFirstLook: mockGetFirstLook,
	getCommitmentsByContact: mockGetByContact,
	updateCommitmentStatus: mockUpdateStatus,
	snoozeCommitment: mockSnoozeCommitment,
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

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function expectNoSensitiveCommitmentFields(value: Record<string, unknown>) {
		for (const field of SENSITIVE_COMMITMENT_FIELDS) {
			expect(value).not.toHaveProperty(field);
		}
	}

	describe('getActiveCommitmentsAction', () => {
		it('fetches active commitments', async () => {
			const { getActiveCommitmentsAction } = await import('@/app/actions/commitments');

			const result = await getActiveCommitmentsAction({});

			expect(result?.data).toBeDefined();
			expect(mockGetActive).toHaveBeenCalled();
			expectNoSensitiveCommitmentFields(result?.data?.[0] as Record<string, unknown>);
		});

		it('accepts optional limit', async () => {
			const { getActiveCommitmentsAction } = await import('@/app/actions/commitments');

			const result = await getActiveCommitmentsAction({
				limit: 5,
			});

			expect(result?.data).toBeDefined();
		});
	});

	describe('getFirstLookCommitmentsAction', () => {
		it('fetches recent active and draft commitments for onboarding review', async () => {
			const { getFirstLookCommitmentsAction } = await import('@/app/actions/commitments');

			const result = await getFirstLookCommitmentsAction({
				limit: 10,
			});

			expect(result?.data?.map((c) => c.status)).toEqual(['active', 'draft']);
			expect(mockGetFirstLook).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.objectContaining({ encryptedWrk: expect.any(Buffer) }),
				expect.objectContaining({ limit: 10 }),
			);
			expectNoSensitiveCommitmentFields(result?.data?.[0] as Record<string, unknown>);
		});
	});

	describe('findCommitmentsForPeriodAction', () => {
		beforeEach(() => {
			vi.stubEnv('WORKER_URL', 'http://localhost:3001');
			vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		});

		it('estimates a bounded commitment search from the server-derived workspace', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						status: 'dry_run',
						workspaceId: WORKSPACE_ID,
						contactLimit: 100,
						batchSize: 200,
						wouldProcessContacts: 4,
						wouldProcessMessages: 123,
						maxAgeDays: 14,
						confirmToken: 'confirm-token',
					}),
			});
			const { findCommitmentsForPeriodAction } = await import('@/app/actions/commitments');

			const result = await findCommitmentsForPeriodAction({
				periodValue: 2,
				periodUnit: 'weeks',
				contactLimit: 100,
				batchSize: 200,
			});

			expect(result?.data).toEqual(
				expect.objectContaining({
					status: 'dry_run',
					wouldProcessContacts: 4,
					wouldProcessMessages: 123,
					maxAgeDays: 14,
					confirmToken: 'confirm-token',
				}),
			);
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/admin/reprocess-messages',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'X-Internal-Secret': 'test-secret',
					}),
				}),
			);
			const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
			expect(body).toMatchObject({
				workspaceId: WORKSPACE_ID,
				userId: 'user-1',
				maxAgeDays: 14,
				contactLimit: 100,
				batchSize: 200,
				dryRun: true,
				confirm: false,
			});
		});

		it('queues the exact estimated commitment search when confirmed', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						status: 'queued',
						contactsProcessed: 3,
						messagesQueued: 72,
						maxAgeDays: 30,
					}),
			});
			const { findCommitmentsForPeriodAction } = await import('@/app/actions/commitments');

			const result = await findCommitmentsForPeriodAction({
				periodValue: 1,
				periodUnit: 'months',
				contactLimit: 25,
				batchSize: 150,
				confirmToken: 'confirm-token',
			});

			expect(result?.data).toEqual(
				expect.objectContaining({
					status: 'queued',
					contactsProcessed: 3,
					messagesQueued: 72,
					maxAgeDays: 30,
				}),
			);
			const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
			expect(body).toMatchObject({
				workspaceId: WORKSPACE_ID,
				userId: 'user-1',
				maxAgeDays: 30,
				contactLimit: 25,
				batchSize: 150,
				dryRun: false,
				confirm: true,
				confirmToken: 'confirm-token',
			});
		});
	});

	describe('getCommitmentsByContactAction', () => {
		it('fetches commitments for a contact', async () => {
			mockGetByContact.mockResolvedValueOnce([mockCommitmentRow]);
			const { getCommitmentsByContactAction } = await import('@/app/actions/commitments');

			const result = await getCommitmentsByContactAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.data).toBeDefined();
			expect(mockGetByContact).toHaveBeenCalled();
			expectNoSensitiveCommitmentFields(result?.data?.[0] as Record<string, unknown>);
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
			expect(result?.data).toEqual(
				expect.objectContaining({
					id: 'c1',
					status: 'completed',
					contactId: 'contact-1',
				}),
			);
			expectNoSensitiveCommitmentFields(result?.data as Record<string, unknown>);
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

	describe('snoozeCommitmentAction', () => {
		it('returns a safe mutation DTO', async () => {
			const { snoozeCommitmentAction } = await import('@/app/actions/commitments');

			const result = await snoozeCommitmentAction({
				commitmentId: '550e8400-e29b-41d4-a716-446655440001',
				snoozedUntil: '2099-05-03T12:00:00.000Z',
			});

			expect(result?.data).toEqual(
				expect.objectContaining({
					id: 'c1',
					status: 'active',
					contactId: 'contact-1',
				}),
			);
			expectNoSensitiveCommitmentFields(result?.data as Record<string, unknown>);
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

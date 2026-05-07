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

const mockGetWorkspaceEnvelope = vi.fn(
	(): Promise<{
		encryptedWrk: Buffer;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	} | null> =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
);

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: mockGetWorkspaceEnvelope,
}));

const mockGetLatestSummary = vi.fn(
	(): Promise<Record<string, unknown> | null> =>
		Promise.resolve({
			id: 's1',
			summary: 'Test summary content',
			status: 'ready',
			generatedAt: '2026-01-01T00:00:00Z',
			messageCount: 50,
			styleVariant: 'summary_formal',
		}),
);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getLatestSummary: mockGetLatestSummary,
}));

describe('summary actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getSummaryAction', () => {
		it('returns summary data for valid contact', async () => {
			const { getSummaryAction } = await import('@/app/actions/summaries');

			const result = await getSummaryAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.data).toBeDefined();
			expect(result?.data?.summary).toBe('Test summary content');
			expect(mockGetLatestSummary).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'550e8400-e29b-41d4-a716-446655440001',
				expect.objectContaining({ encryptedWrk: expect.any(Buffer) }),
			);
		});

		it('returns null when no summary exists', async () => {
			mockGetLatestSummary.mockResolvedValueOnce(null);
			const { getSummaryAction } = await import('@/app/actions/summaries');

			const result = await getSummaryAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.data).toBeNull();
		});

		it('throws when no envelope available', async () => {
			mockGetWorkspaceEnvelope.mockResolvedValueOnce(null);

			const { getSummaryAction } = await import('@/app/actions/summaries');

			const result = await getSummaryAction({
				contactId: '550e8400-e29b-41d4-a716-446655440001',
			});

			expect(result?.serverError).toBeDefined();
		});

		it('rejects invalid UUID inputs', async () => {
			const { getSummaryAction } = await import('@/app/actions/summaries');

			const result = await getSummaryAction({
				contactId: 'not-a-uuid',
			});

			expect(result?.validationErrors).toBeDefined();
		});
	});
});

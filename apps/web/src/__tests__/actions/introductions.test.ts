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
const INTRODUCTION_ID = '550e8400-e29b-41d4-a716-446655440001';
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockList = vi.fn(() => Promise.resolve([{ id: INTRODUCTION_ID, status: 'triage' }]));
const mockUpdate = vi.fn(
	async (): Promise<{ id: string; status: string } | null> => ({
		id: INTRODUCTION_ID,
		status: 'active',
	}),
);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listIntroductions: mockList,
	updateIntroductionStatus: mockUpdate,
}));

describe('introductions actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('listIntroductionsAction passes workspace, envelope, and status filter to the DAL', async () => {
		const { listIntroductionsAction } = await import('@/app/actions/introductions');

		const result = await listIntroductionsAction({ status: 'triage', limit: 25 });

		expect(result?.data).toBeDefined();
		expect(mockList).toHaveBeenCalledWith(
			WORKSPACE_ID,
			{ status: 'triage', limit: 25 },
			MOCK_ENVELOPE,
		);
	});

	it('listIntroductionsAction rejects unknown status filters', async () => {
		const { listIntroductionsAction } = await import('@/app/actions/introductions');

		const result = await listIntroductionsAction({ status: 'confirmed' as never });

		expect(result?.validationErrors).toBeDefined();
		expect(mockList).not.toHaveBeenCalled();
	});

	it('updateIntroStatusAction records review approval transitions', async () => {
		const { updateIntroStatusAction } = await import('@/app/actions/introductions');

		const result = await updateIntroStatusAction({
			introductionId: INTRODUCTION_ID,
			status: 'active',
		});

		expect(result?.data).toBeDefined();
		expect(mockUpdate).toHaveBeenCalledWith(WORKSPACE_ID, INTRODUCTION_ID, 'active', undefined);
	});

	it('updateIntroStatusAction passes dismissal resolution when archiving', async () => {
		const { updateIntroStatusAction } = await import('@/app/actions/introductions');

		await updateIntroStatusAction({
			introductionId: INTRODUCTION_ID,
			status: 'archive',
			resolution: 'dismissed',
		});

		expect(mockUpdate).toHaveBeenCalledWith(WORKSPACE_ID, INTRODUCTION_ID, 'archive', {
			resolution: 'dismissed',
		});
	});

	it('updateIntroStatusAction returns a safe error when the DAL rejects the transition', async () => {
		mockUpdate.mockResolvedValueOnce(null);
		const { updateIntroStatusAction } = await import('@/app/actions/introductions');

		const result = await updateIntroStatusAction({
			introductionId: INTRODUCTION_ID,
			status: 'active',
		});

		expect(result?.serverError).toBe('Invalid input');
	});
});

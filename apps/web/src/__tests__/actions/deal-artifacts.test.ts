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
const DEAL_ID = '550e8400-e29b-41d4-a716-446655440002';
const ARTIFACT_ID = '550e8400-e29b-41d4-a716-446655440003';
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockListArtifacts = vi.fn((..._args: unknown[]) =>
	Promise.resolve([{ id: ARTIFACT_ID, title: 'Term Sheet', url: 'https://example.com/terms' }]),
);
const mockAddArtifact = vi.fn((..._args: unknown[]) =>
	Promise.resolve({ id: ARTIFACT_ID, title: 'Term Sheet', url: 'https://example.com/terms' }),
);
const mockRemoveArtifact = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	createDeal: vi.fn(),
	listDeals: vi.fn(),
	updateDeal: vi.fn(),
	addDealParticipant: vi.fn(),
	listDealParticipants: vi.fn(),
	removeDealParticipant: vi.fn(),
	addDealArtifact: (workspaceId: unknown, input: unknown, envelope: unknown) =>
		mockAddArtifact(workspaceId, input, envelope),
	listDealArtifacts: (workspaceId: unknown, dealId: unknown, envelope: unknown) =>
		mockListArtifacts(workspaceId, dealId, envelope),
	removeDealArtifact: (workspaceId: unknown, artifactId: unknown) =>
		mockRemoveArtifact(workspaceId, artifactId),
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

describe('deal artifact actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists artifacts with the workspace envelope', async () => {
		const { listDealArtifactsAction } = await import('@/app/actions/deals');
		const result = await listDealArtifactsAction({ dealId: DEAL_ID });

		expect(result?.data).toBeDefined();
		expect(mockListArtifacts).toHaveBeenCalledWith(WORKSPACE_ID, DEAL_ID, MOCK_ENVELOPE);
	});

	it('adds artifacts with trimmed sensitive fields and the workspace envelope', async () => {
		const { addDealArtifactAction } = await import('@/app/actions/deals');
		const result = await addDealArtifactAction({
			dealId: DEAL_ID,
			title: '  Sensitive term sheet  ',
			artifactType: 'term_sheet',
			url: '  https://example.com/private/terms.pdf  ',
		});

		expect(result?.data).toBeDefined();
		expect(mockAddArtifact).toHaveBeenCalledWith(
			WORKSPACE_ID,
			{
				dealId: DEAL_ID,
				title: 'Sensitive term sheet',
				artifactType: 'term_sheet',
				url: 'https://example.com/private/terms.pdf',
			},
			MOCK_ENVELOPE,
		);
	});

	it('rejects blank artifact titles after trimming', async () => {
		const { addDealArtifactAction } = await import('@/app/actions/deals');
		const result = await addDealArtifactAction({
			dealId: DEAL_ID,
			title: '   ',
		});

		expect(result?.validationErrors).toBeDefined();
		expect(mockAddArtifact).not.toHaveBeenCalled();
	});

	it('removes artifacts by id and workspace', async () => {
		const { removeDealArtifactAction } = await import('@/app/actions/deals');
		await removeDealArtifactAction({ artifactId: ARTIFACT_ID });

		expect(mockRemoveArtifact).toHaveBeenCalledWith(WORKSPACE_ID, ARTIFACT_ID);
	});
});

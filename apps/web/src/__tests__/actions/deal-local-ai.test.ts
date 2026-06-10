import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('next/cache', () => ({
	revalidatePath: vi.fn(),
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
const RUN_ID = '550e8400-e29b-41d4-a716-446655440099';
const ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(ENVELOPE)),
}));

const fetchMock = vi.hoisted(() => vi.fn());
const mockGetDeal = vi.hoisted(() => vi.fn());
const mockParticipants = vi.hoisted(() => vi.fn());
const mockArtifacts = vi.hoisted(() => vi.fn());
const mockStageEvents = vi.hoisted(() => vi.fn());
const mockEvidence = vi.hoisted(() => vi.fn());
const mockSave = vi.hoisted(() => vi.fn());
const mockUpdateStatus = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	createDeal: vi.fn(),
	listDeals: vi.fn(),
	updateDeal: vi.fn(),
	deleteDeal: vi.fn(),
	getDeal: mockGetDeal,
	listDealParticipants: mockParticipants,
	listDealArtifacts: mockArtifacts,
	listDealStageEvents: mockStageEvents,
	listDealEvidenceLinks: mockEvidence,
	listDealAiRuns: vi.fn(),
	saveDealAiRun: mockSave,
	updateDealAiRunStatus: mockUpdateStatus,
	addDealParticipant: vi.fn(),
	removeDealParticipant: vi.fn(),
	updateDealParticipant: vi.fn(),
	addDealArtifact: vi.fn(),
	removeDealArtifact: vi.fn(),
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

describe('deal local AI actions', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		vi.clearAllMocks();
		mockGetDeal.mockResolvedValue({
			id: DEAL_ID,
			workspaceId: WORKSPACE_ID,
			contactId: '550e8400-e29b-41d4-a716-446655440001',
			title: 'Aptos Series A',
			stage: 'diligence',
			value: 2_000_000_00,
			notes: 'Source-backed diligence deal.',
			updatedAt: new Date('2026-06-09T12:00:00Z'),
		});
		mockParticipants.mockResolvedValue([
			{
				id: '550e8400-e29b-41d4-a716-446655440010',
				workspaceId: WORKSPACE_ID,
				dealId: DEAL_ID,
				contactId: '550e8400-e29b-41d4-a716-446655440001',
				role: 'lead',
			},
		]);
		mockArtifacts.mockResolvedValue([
			{
				id: '550e8400-e29b-41d4-a716-446655440011',
				workspaceId: WORKSPACE_ID,
				dealId: DEAL_ID,
				title: 'Encrypted SAFT',
				artifactType: 'saft',
			},
		]);
		mockStageEvents.mockResolvedValue([
			{
				id: '550e8400-e29b-41d4-a716-446655440012',
				workspaceId: WORKSPACE_ID,
				dealId: DEAL_ID,
				previousStage: 'discovery',
				nextStage: 'diligence',
				note: 'Positive first call',
			},
		]);
		mockEvidence.mockResolvedValue([
			{
				id: '550e8400-e29b-41d4-a716-446655440013',
				workspaceId: WORKSPACE_ID,
				dealId: DEAL_ID,
				sourceType: 'deal_artifact',
				sourceId: '550e8400-e29b-41d4-a716-446655440011',
				label: 'SAFT',
				summary: 'Terms are attached.',
			},
		]);
		mockSave.mockImplementation((_workspaceId, input) =>
			Promise.resolve({
				id: RUN_ID,
				workspaceId: WORKSPACE_ID,
				...input,
				createdAt: new Date('2026-06-09T12:00:00Z'),
			}),
		);
		mockUpdateStatus.mockResolvedValue({
			id: RUN_ID,
			status: 'accepted',
		});
	});

	it('generates and saves a deterministic local fallback without vendor egress', async () => {
		vi.stubEnv('OPENAI_API_KEY', 'sk-test');
		vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
		vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
		vi.stubEnv('CHAT_LLM_PROVIDER', 'cloud');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');

		const { generateDealLocalAiAction } = await import('@/app/actions/deals');
		const result = await generateDealLocalAiAction({
			dealId: DEAL_ID,
			runType: 'brief',
		});

		expect(result?.data?.id).toBe(RUN_ID);
		expect(result?.data?.sourceCount).toBeGreaterThanOrEqual(2);
		expect(JSON.stringify(result?.data)).not.toContain('sourceManifest');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mockSave).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				dealId: DEAL_ID,
				runType: 'brief',
				status: 'draft',
				modelRole: 'deterministic_fallback',
				modelName: 'local-context-rules',
				localVendorMode: 'deterministic_fallback',
				output: expect.stringContaining('Aptos Series A'),
				sourceManifest: expect.arrayContaining([
					expect.objectContaining({ type: 'deal' }),
					expect.objectContaining({ type: 'deal_artifact' }),
				]),
			}),
			ENVELOPE,
		);
	});

	it('refuses unsupported questions when no source evidence is linked', async () => {
		mockEvidence.mockResolvedValueOnce([]);

		const { generateDealLocalAiAction } = await import('@/app/actions/deals');
		await generateDealLocalAiAction({
			dealId: DEAL_ID,
			runType: 'question_answer',
			question: 'What wire instructions did they send?',
		});

		expect(mockSave).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				runType: 'question_answer',
				output: expect.stringContaining('I do not have enough linked source evidence'),
				uncertainty: expect.stringContaining('High uncertainty'),
			}),
			ENVELOPE,
		);
	});

	it('accepts or dismisses suggestions through explicit status actions only', async () => {
		const { updateDealAiRunStatusAction } = await import('@/app/actions/deals');
		const result = await updateDealAiRunStatusAction({
			runId: RUN_ID,
			status: 'accepted',
		});

		expect(result?.data).toEqual({ id: RUN_ID, status: 'accepted' });
		expect(mockUpdateStatus).toHaveBeenCalledWith(WORKSPACE_ID, RUN_ID, 'accepted');
	});
});

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
const CONNECTION_ID = '550e8400-e29b-41d4-a716-446655440001';
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockList = vi.fn(() => Promise.resolve([{ id: CONNECTION_ID, status: 'detected' }]));
const mockUpdate = vi.fn(async () => ({ id: CONNECTION_ID, status: 'confirmed' }));
const mockUpdateStatus = vi.fn(async () => ({ id: CONNECTION_ID, status: 'confirmed' }));
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listConnections: mockList,
	updateConnection: mockUpdate,
	updateConnectionStatus: mockUpdateStatus,
}));

describe('connections actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('listConnectionsAction passes workspace, envelope, and filters to the DAL', async () => {
		const { listConnectionsAction } = await import('@/app/actions/connections');

		const result = await listConnectionsAction({
			status: 'detected',
			event: 'ETHDenver',
			limit: 25,
		});

		expect(result?.data).toBeDefined();
		expect(mockList).toHaveBeenCalledWith(
			WORKSPACE_ID,
			{ status: 'detected', event: 'ETHDenver', limit: 25 },
			MOCK_ENVELOPE,
		);
	});

	it('findConnectionsForPeriodAction estimates a bounded contact search', async () => {
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					status: 'dry_run',
					workspaceId: WORKSPACE_ID,
					contactLimit: 50,
					batchSize: 150,
					wouldProcessContacts: 4,
					wouldProcessMessages: 222,
					maxAgeDays: 14,
					confirmToken: 'confirm-token',
				}),
		});
		const { findConnectionsForPeriodAction } = await import('@/app/actions/connections');

		const result = await findConnectionsForPeriodAction({
			periodValue: 2,
			periodUnit: 'weeks',
			contactLimit: 50,
			batchSize: 150,
		});

		expect(result?.data).toEqual(
			expect.objectContaining({
				status: 'dry_run',
				wouldProcessContacts: 4,
				wouldProcessMessages: 222,
				maxAgeDays: 14,
				confirmToken: 'confirm-token',
			}),
		);
		expect(mockFetch).toHaveBeenCalledWith(
			'http://localhost:3001/admin/reprocess-connections',
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
			contactLimit: 50,
			batchSize: 150,
			dryRun: true,
			confirm: false,
		});
	});

	it('findConnectionsForPeriodAction queues the exact estimated search when confirmed', async () => {
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					status: 'queued',
					contactsProcessed: 2,
					messagesQueued: 200,
					maxAgeDays: 30,
				}),
		});
		const { findConnectionsForPeriodAction } = await import('@/app/actions/connections');

		const result = await findConnectionsForPeriodAction({
			periodValue: 30,
			periodUnit: 'days',
			contactLimit: 25,
			batchSize: 100,
			confirmToken: 'confirm-token',
		});

		expect(result?.data).toEqual(
			expect.objectContaining({
				status: 'queued',
				contactsProcessed: 2,
				messagesQueued: 200,
				maxAgeDays: 30,
			}),
		);
		const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
		expect(body).toMatchObject({
			workspaceId: WORKSPACE_ID,
			userId: 'user-1',
			maxAgeDays: 30,
			contactLimit: 25,
			batchSize: 100,
			dryRun: false,
			confirm: true,
			confirmToken: 'confirm-token',
		});
	});
});

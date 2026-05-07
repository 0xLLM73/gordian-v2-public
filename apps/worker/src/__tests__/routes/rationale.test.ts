import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRationaleQueueAdd = vi.hoisted(() => vi.fn());

vi.mock('../../queues/rationale-extraction', () => ({
	rationaleQueue: {
		add: mockRationaleQueueAdd,
	},
	rationaleExtractionWorker: {},
}));

vi.mock('../../redis', () => ({ connection: {} }));

vi.mock('bullmq', () => ({
	Queue: vi.fn(),
	Worker: vi.fn(function MockWorker() {
		return { on: vi.fn() };
	}),
}));

process.env.WORKER_INTERNAL_SECRET = 'test-secret';

const SECRET = 'test-secret';
const WRONG_SECRET = 'bad-secret';
// Zod v4 requires RFC-compliant UUIDs (version 1-8, variant 8-b)
const WS = 'b33d11fe-e592-434a-9457-c5aa9774795e';
const ENTITY = '9526a231-f428-481e-869e-fd7f946cafad';
const CONTACT = '5079f7e9-d630-43e0-bdd0-3d694c36f20e';

const VALID_BODY = {
	action: 'deal_lost',
	label: 'Deal stage → lost',
	contactId: CONTACT,
	entityId: ENTITY,
	entityType: 'deal',
	workspaceId: WS,
	keyEnvelope: {
		encryptedWrk: 'dGVzdC1rZXk=',
		kmsContext: { WorkspaceID: WS },
		wrkVersion: 1,
	},
};

describe('POST /rationale/extract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRationaleQueueAdd.mockResolvedValue({ id: 'job-1' });
	});

	it('returns 401 when X-Internal-Secret header is missing', async () => {
		const { default: rationaleRoutes } = await import('../../routes/rationale');
		const res = await rationaleRoutes.request('/rationale/extract', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe('Unauthorized');
	});

	it('returns 401 when X-Internal-Secret is wrong', async () => {
		const { default: rationaleRoutes } = await import('../../routes/rationale');
		const res = await rationaleRoutes.request('/rationale/extract', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': WRONG_SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
	});

	it('returns 400 when body has invalid UUID fields', async () => {
		const { default: rationaleRoutes } = await import('../../routes/rationale');
		const res = await rationaleRoutes.request('/rationale/extract', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify({ ...VALID_BODY, entityId: 'not-a-uuid' }),
		});

		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string; details: unknown[] };
		expect(json.error).toBe('Invalid request');
		expect(json.details).toBeDefined();
	});

	it('returns 400 when required fields are missing', async () => {
		const { default: rationaleRoutes } = await import('../../routes/rationale');
		const res = await rationaleRoutes.request('/rationale/extract', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify({ action: 'test' }),
		});

		expect(res.status).toBe(400);
	});

	it('returns 400 when entityType is invalid', async () => {
		const { default: rationaleRoutes } = await import('../../routes/rationale');
		const res = await rationaleRoutes.request('/rationale/extract', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify({ ...VALID_BODY, entityType: 'invalid' }),
		});

		expect(res.status).toBe(400);
	});

	it('returns 200 and queues job with valid request', async () => {
		const { default: rationaleRoutes } = await import('../../routes/rationale');
		const res = await rationaleRoutes.request('/rationale/extract', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { queued: boolean };
		expect(json.queued).toBe(true);
	});

	it('enqueues job with correct dedup ID (SEC-PROV-014)', async () => {
		const { default: rationaleRoutes } = await import('../../routes/rationale');
		await rationaleRoutes.request('/rationale/extract', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(mockRationaleQueueAdd).toHaveBeenCalledWith('extract', VALID_BODY, {
			jobId: `rationale-deal-${ENTITY}`,
		});
	});
});

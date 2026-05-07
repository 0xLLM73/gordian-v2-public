import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDigestQueueAdd = vi.hoisted(() => vi.fn());

vi.mock('../../queues/digest', () => ({
	digestQueue: {
		add: mockDigestQueueAdd,
	},
	digestWorker: {},
}));

vi.mock('../../redis', () => ({ connection: {} }));

process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const SECRET = 'test-secret';
const WRONG_SECRET = 'bad-secret';

const VALID_BODY = {
	userId: 'user-1',
	workspaceId: 'ws-1',
	period: 'week',
};

describe('POST /digest/generate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDigestQueueAdd.mockResolvedValue({ id: 'job-1' });
	});

	it('returns 401 when X-Internal-Secret header is missing', async () => {
		const { digest } = await import('../../routes/digest');
		const res = await digest.request('/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe('Unauthorized');
	});

	it('returns 401 when X-Internal-Secret is wrong', async () => {
		const { digest } = await import('../../routes/digest');
		const res = await digest.request('/generate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': WRONG_SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
	});

	it('returns 400 when required fields are missing', async () => {
		const { digest } = await import('../../routes/digest');
		const res = await digest.request('/generate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify({ userId: 'user-1' }),
		});

		expect(res.status).toBe(400);
	});

	it('enqueues digest job without envelope in payload (SEC-028)', async () => {
		const { digest } = await import('../../routes/digest');
		const res = await digest.request('/generate', {
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

		// SEC-028: job data must NOT contain keyEnvelope or workspaceSalt
		expect(mockDigestQueueAdd).toHaveBeenCalledOnce();
		const [, jobData] = mockDigestQueueAdd.mock.calls[0];
		expect(jobData).not.toHaveProperty('keyEnvelope');
		expect(jobData).not.toHaveProperty('workspaceSalt');
		expect(jobData.userId).toBe('user-1');
		expect(jobData.workspaceId).toBe('ws-1');
		expect(jobData.period).toBe('week');
	});

	it('deduplicates by userId+period jobId', async () => {
		const { digest } = await import('../../routes/digest');
		await digest.request('/generate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		const [, , options] = mockDigestQueueAdd.mock.calls[0];
		expect(options.jobId).toBe(`digest-${VALID_BODY.userId}-${VALID_BODY.period}`);
	});
});

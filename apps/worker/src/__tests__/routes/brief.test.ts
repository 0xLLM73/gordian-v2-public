import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLatestBrief = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	getLatestBrief: mockGetLatestBrief,
}));

process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const SECRET = 'test-secret';
const WRONG_SECRET = 'bad-secret';

const VALID_BODY = {
	userId: 'user-1',
	workspaceId: 'ws-1',
	envelope: {
		encryptedWrk: Buffer.from('test-key').toString('base64'),
		kmsContext: { workspaceId: 'ws-1' },
		wrkVersion: 1,
	},
};

describe('POST /brief/latest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when X-Internal-Secret header is missing', async () => {
		const { briefRoutes } = await import('../../routes/brief');
		const res = await briefRoutes.request('/latest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe('Unauthorized');
	});

	it('returns 401 when X-Internal-Secret is wrong', async () => {
		const { briefRoutes } = await import('../../routes/brief');
		const res = await briefRoutes.request('/latest', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': WRONG_SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
	});

	it('returns 400 when userId is missing', async () => {
		const { briefRoutes } = await import('../../routes/brief');
		const { userId: _u, ...bodyWithoutUserId } = VALID_BODY;
		const res = await briefRoutes.request('/latest', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(bodyWithoutUserId),
		});

		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe('userId, workspaceId, and envelope are required');
	});

	it('returns 200 with brief shape on valid request', async () => {
		const mockBrief = {
			id: 'brief-uuid-1',
			content: 'Good morning! Here is your brief.',
			toneTraceId: 'tone-trace-1',
			detailTraceId: 'detail-trace-1',
			toneVariant: 'brief_tone_casual',
			detailVariant: 'brief_detail_low',
			feedback: null,
			generatedAt: new Date('2026-02-23T07:00:00Z'),
		};
		mockGetLatestBrief.mockResolvedValueOnce(mockBrief);

		const { briefRoutes } = await import('../../routes/brief');
		const res = await briefRoutes.request('/latest', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as typeof mockBrief;
		expect(json.id).toBe('brief-uuid-1');
		expect(json.content).toBe('Good morning! Here is your brief.');
		expect(json.toneVariant).toBe('brief_tone_casual');
		expect(json.feedback).toBeNull();
	});

	it('returns 200 with null when no brief exists yet', async () => {
		mockGetLatestBrief.mockResolvedValueOnce(null);

		const { briefRoutes } = await import('../../routes/brief');
		const res = await briefRoutes.request('/latest', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toBeNull();
	});
});

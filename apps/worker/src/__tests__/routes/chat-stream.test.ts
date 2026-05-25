import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockChat = vi.hoisted(() => vi.fn());
const mockChatStream = vi.hoisted(() => vi.fn());
const mockHasUserAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockIsWorkspaceMember = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	hasUserAiAnalysisConsent: mockHasUserAiAnalysisConsent,
	isWorkspaceMember: mockIsWorkspaceMember,
}));

vi.mock('../../ai/chat', () => ({
	chat: mockChat,
	ChatMessage: {},
}));

vi.mock('../../ai/chat-stream', () => ({
	chatStream: mockChatStream,
}));

process.env.WORKER_INTERNAL_SECRET = 'test-secret';

const SECRET = 'test-secret';
const WRONG_SECRET = 'bad-secret';
const USER = '8cb49fc0-1ef8-4bbb-8b9a-300a6a2f0466';
const WS = 'b33d11fe-e592-434a-9457-c5aa9774795e';

const VALID_BODY = {
	userId: USER,
	workspaceId: WS,
	messages: [{ role: 'user', content: 'Hello' }],
	envelope: {
		encryptedWrk: 'dGVzdC1rZXk=',
		kmsContext: { WorkspaceID: WS },
		wrkVersion: 1,
	},
};

function parseSSE(text: string): Array<{ event: string; data: string; id?: string }> {
	const events: Array<{ event: string; data: string; id?: string }> = [];
	const blocks = text.split('\n\n').filter(Boolean);
	for (const block of blocks) {
		const lines = block.split('\n');
		const entry: Record<string, string> = {};
		for (const line of lines) {
			const [key, ...rest] = line.split(':');
			entry[key.trim()] = rest.join(':').trim();
		}
		if (entry.event && entry.data) {
			events.push({ event: entry.event, data: entry.data, id: entry.id });
		}
	}
	return events;
}

describe('POST /chat (non-streaming fallback)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsWorkspaceMember.mockResolvedValue(true);
		mockHasUserAiAnalysisConsent.mockResolvedValue(true);
	});

	it('returns 401 when X-Internal-Secret is missing', async () => {
		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(VALID_BODY),
		});
		expect(res.status).toBe(401);
	});

	it('returns 400 when required fields are missing', async () => {
		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify({ messages: [] }),
		});
		expect(res.status).toBe(400);
	});

	it('returns chat result on success', async () => {
		mockChat.mockResolvedValue({ text: 'Hello!', toolsUsed: [] });
		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { text: string };
		expect(json.text).toBe('Hello!');
	});
});

describe('POST /chat/stream', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsWorkspaceMember.mockResolvedValue(true);
		mockHasUserAiAnalysisConsent.mockResolvedValue(true);
	});

	it('returns 401 when X-Internal-Secret is missing', async () => {
		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(VALID_BODY),
		});
		expect(res.status).toBe(401);
	});

	it('returns 401 when X-Internal-Secret is wrong', async () => {
		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/stream', {
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
		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/stream', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify({ messages: [] }),
		});
		expect(res.status).toBe(400);
	});

	it('returns 403 when AI consent is not persisted', async () => {
		mockHasUserAiAnalysisConsent.mockResolvedValue(false);
		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/stream', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(403);
		expect(mockChatStream).not.toHaveBeenCalled();
	});

	it('streams SSE events from chatStream callbacks', async () => {
		mockChatStream.mockImplementation(
			async (
				_ws: string,
				_env: unknown,
				_msgs: unknown[],
				_sys: string,
				callbacks: {
					onToolStart: (name: string) => Promise<void>;
					onToolEnd: (name: string) => Promise<void>;
					onTextDelta: (text: string) => Promise<void>;
					onDone: (tools: string[]) => Promise<void>;
				},
			) => {
				await callbacks.onToolStart('search_contacts');
				await callbacks.onToolEnd('search_contacts');
				await callbacks.onTextDelta('Based on');
				await callbacks.onTextDelta(' your contacts');
				await callbacks.onDone(['search_contacts']);
			},
		);

		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/stream', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');

		const text = await res.text();
		const events = parseSSE(text);

		expect(events[0].event).toBe('tool_start');
		expect(JSON.parse(events[0].data)).toEqual({ tool: 'search_contacts' });

		expect(events[1].event).toBe('tool_end');
		expect(JSON.parse(events[1].data)).toEqual({ tool: 'search_contacts' });

		expect(events[2].event).toBe('text_delta');
		expect(JSON.parse(events[2].data)).toEqual({ text: 'Based on' });

		expect(events[3].event).toBe('text_delta');
		expect(JSON.parse(events[3].data)).toEqual({ text: ' your contacts' });

		expect(events[4].event).toBe('done');
		expect(JSON.parse(events[4].data)).toEqual({ toolsUsed: ['search_contacts'] });
	});

	it('emits error event when chatStream calls onError', async () => {
		mockChatStream.mockImplementation(
			async (
				_ws: string,
				_env: unknown,
				_msgs: unknown[],
				_sys: string,
				callbacks: { onError: (msg: string) => Promise<void> },
			) => {
				await callbacks.onError('Something went wrong');
			},
		);

		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/stream', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(200);
		const text = await res.text();
		const events = parseSSE(text);

		const errorEvent = events.find((e) => e.event === 'error');
		expect(errorEvent).toBeDefined();
		expect(JSON.parse(errorEvent?.data ?? '')).toEqual({ message: 'Something went wrong' });
	});

	it('passes envelope with Buffer.from base64 conversion', async () => {
		mockChatStream.mockImplementation(async () => {});

		const { chatRoutes } = await import('../../routes/chat');
		await chatRoutes.request('/stream', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(mockChatStream).toHaveBeenCalledWith(
			WS,
			{
				encryptedWrk: Buffer.from('dGVzdC1rZXk=', 'base64'),
				kmsContext: { WorkspaceID: WS },
				wrkVersion: 1,
			},
			VALID_BODY.messages,
			'',
			expect.any(Object),
			undefined,
		);
	});

	it('includes context field when provided', async () => {
		mockChatStream.mockImplementation(async () => {});

		const bodyWithContext = {
			...VALID_BODY,
			context: { contactId: 'abc-123' },
		};

		const { chatRoutes } = await import('../../routes/chat');
		await chatRoutes.request('/stream', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(bodyWithContext),
		});

		// chatStream is called — context is accepted by the route (used in Phase 3)
		expect(mockChatStream).toHaveBeenCalled();
	});

	it('increments event IDs sequentially', async () => {
		mockChatStream.mockImplementation(
			async (
				_ws: string,
				_env: unknown,
				_msgs: unknown[],
				_sys: string,
				callbacks: {
					onTextDelta: (text: string) => Promise<void>;
					onDone: (tools: string[]) => Promise<void>;
				},
			) => {
				await callbacks.onTextDelta('a');
				await callbacks.onTextDelta('b');
				await callbacks.onDone([]);
			},
		);

		const { chatRoutes } = await import('../../routes/chat');
		const res = await chatRoutes.request('/stream', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		const text = await res.text();
		const events = parseSSE(text);

		expect(events[0].id).toBe('1');
		expect(events[1].id).toBe('2');
		expect(events[2].id).toBe('3');
	});
});

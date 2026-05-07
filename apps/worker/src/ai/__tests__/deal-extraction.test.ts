import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────────

const mockInferWithGemini = vi.hoisted(() => vi.fn());
const mockCreateDealCandidate = vi.hoisted(() => vi.fn());
const mockIsDuplicateCandidate = vi.hoisted(() => vi.fn());

vi.mock('../gemini-inference', () => ({
	inferWithGemini: mockInferWithGemini,
}));

vi.mock('@repo/db', () => ({
	createDealCandidate: mockCreateDealCandidate,
	isDuplicateCandidate: mockIsDuplicateCandidate,
}));

import { extractDealCandidate } from '../deal-extraction';

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const CHAT = 'chat-123';
const MSG = 'msg-456';
const CONTACT = 'contact-789';
const testEnvelope = {
	encryptedWrk: Buffer.from('test-wrk'),
	kmsContext: { workspaceId: WS },
	wrkVersion: 1,
};

function geminiReturns(result: {
	dealTitleGuess: string;
	dealTypeGuess: string;
	confidence: number;
	signals: string[];
}) {
	mockInferWithGemini.mockResolvedValueOnce(JSON.stringify(result));
}

const VALID_EXTRACTION = {
	dealTitleGuess: 'Series A for [PROJECT]',
	dealTypeGuess: 'saft',
	confidence: 0.92,
	signals: ['term sheet for $2M', 'SAFT allocation'],
};

const FAKE_CANDIDATE = {
	id: 'cand-001',
	workspaceId: WS,
	chatId: CHAT,
	sourceMessageId: MSG,
	confidence: 0.92,
	dealTitleGuess: 'Series A for [PROJECT]',
	dealTypeGuess: 'saft',
	signals: [
		{ text: 'term sheet for $2M', tier: 1 },
		{ text: 'SAFT allocation', tier: 1 },
	],
	status: 'pending',
	createdAt: new Date(),
};

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('extractDealCandidate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateDealCandidate.mockResolvedValue(FAKE_CANDIDATE);
		mockIsDuplicateCandidate.mockResolvedValue(false);
	});

	// ─── Successful extraction ───────────────────────────────────────────────

	describe('successful extraction', () => {
		it('extracts and stores a deal candidate', async () => {
			geminiReturns(VALID_EXTRACTION);
			const result = await extractDealCandidate(
				'Our term sheet for $2M SAFT allocation',
				CHAT,
				MSG,
				WS,
				testEnvelope,
			);
			expect(result).toEqual(FAKE_CANDIDATE);
			expect(mockCreateDealCandidate).toHaveBeenCalledWith(
				WS,
				{
					sourceMessageId: MSG,
					chatId: CHAT,
					confidence: 0.92,
					contactId: undefined,
					dealTitleGuess: 'Series A for [PROJECT]',
					dealTypeGuess: 'saft',
					signals: [
						{ text: 'term sheet for $2M', tier: 1 },
						{ text: 'SAFT allocation', tier: 1 },
					],
				},
				testEnvelope,
			);
		});

		it('passes contactId to DAL when provided', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('SAFT for $1M', CHAT, MSG, WS, testEnvelope, CONTACT);
			expect(mockCreateDealCandidate).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ contactId: CONTACT }),
				testEnvelope,
			);
		});

		it('sends message text to Gemini as userPrompt', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('term sheet $5M', CHAT, MSG, WS, testEnvelope);
			expect(mockInferWithGemini).toHaveBeenCalledWith({
				systemPrompt: expect.stringContaining('extracting structured deal'),
				userPrompt: 'term sheet $5M',
			});
		});

		it('handles markdown-wrapped JSON from Gemini', async () => {
			mockInferWithGemini.mockResolvedValueOnce(
				`\`\`\`json\n${JSON.stringify(VALID_EXTRACTION)}\n\`\`\``,
			);
			const result = await extractDealCandidate('SAFT $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toEqual(FAKE_CANDIDATE);
		});
	});

	// ─── Deal type normalization ─────────────────────────────────────────────

	describe('deal type normalization', () => {
		it.each([
			['SAFT', 'saft'],
			['Equity', 'equity'],
			['Token Warrant', 'token_warrant'],
			['convertible_note', 'convertible_note'],
			['Advisory', 'advisory'],
			['something_else', 'unknown'],
			['gibberish', 'unknown'],
		])('normalizes "%s" to "%s"', async (input, expected) => {
			geminiReturns({ ...VALID_EXTRACTION, dealTypeGuess: input });
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			expect(mockCreateDealCandidate).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ dealTypeGuess: expected }),
				testEnvelope,
			);
		});
	});

	// ─── Confidence handling ─────────────────────────────────────────────────

	describe('confidence handling', () => {
		it('clamps confidence to [0, 1]', async () => {
			geminiReturns({ ...VALID_EXTRACTION, confidence: 1.5 });
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			expect(mockCreateDealCandidate).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({ confidence: 1 }),
				testEnvelope,
			);
		});

		it('returns null when confidence is 0', async () => {
			geminiReturns({ ...VALID_EXTRACTION, confidence: 0 });
			const result = await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
			expect(mockCreateDealCandidate).not.toHaveBeenCalled();
		});

		it('returns null when confidence is negative', async () => {
			geminiReturns({ ...VALID_EXTRACTION, confidence: -0.5 });
			const result = await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
			expect(mockCreateDealCandidate).not.toHaveBeenCalled();
		});
	});

	// ─── Signal normalization ────────────────────────────────────────────────

	describe('signal normalization', () => {
		it('filters out non-string signals', async () => {
			geminiReturns({
				...VALID_EXTRACTION,
				signals: ['valid signal', 123, null, 'another signal'] as unknown as string[],
			});
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			expect(mockCreateDealCandidate).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({
					signals: [
						{ text: 'valid signal', tier: 1 },
						{ text: 'another signal', tier: 1 },
					],
				}),
				testEnvelope,
			);
		});

		it('limits signals to 5 entries', async () => {
			geminiReturns({
				...VALID_EXTRACTION,
				signals: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
			});
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			const call = mockCreateDealCandidate.mock.calls[0];
			expect(call[1].signals).toHaveLength(5);
		});

		it('filters out empty/whitespace signals', async () => {
			geminiReturns({
				...VALID_EXTRACTION,
				signals: ['valid', '', '   ', 'also valid'],
			});
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			expect(mockCreateDealCandidate).toHaveBeenCalledWith(
				WS,
				expect.objectContaining({
					signals: [
						{ text: 'valid', tier: 1 },
						{ text: 'also valid', tier: 1 },
					],
				}),
				testEnvelope,
			);
		});

		it('truncates individual signals to 500 chars', async () => {
			const longSignal = 'x'.repeat(600);
			geminiReturns({ ...VALID_EXTRACTION, signals: [longSignal] });
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			const call = mockCreateDealCandidate.mock.calls[0];
			expect(call[1].signals[0].text).toHaveLength(500);
		});
	});

	// ─── Dedup ───────────────────────────────────────────────────────────────

	describe('dedup', () => {
		it('skips dedup check when no contactId provided', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			expect(mockIsDuplicateCandidate).not.toHaveBeenCalled();
		});

		it('checks for duplicates when contactId is provided', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope, CONTACT);
			expect(mockIsDuplicateCandidate).toHaveBeenCalledWith(WS, CONTACT, [
				{ text: 'term sheet for $2M', tier: 1 },
				{ text: 'SAFT allocation', tier: 1 },
			]);
		});

		it('returns null when duplicate is detected', async () => {
			geminiReturns(VALID_EXTRACTION);
			mockIsDuplicateCandidate.mockResolvedValueOnce(true);
			const result = await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope, CONTACT);
			expect(result).toBeNull();
			expect(mockCreateDealCandidate).not.toHaveBeenCalled();
		});

		it('proceeds with insert if dedup check fails', async () => {
			geminiReturns(VALID_EXTRACTION);
			mockIsDuplicateCandidate.mockRejectedValueOnce(new Error('DB error'));
			const result = await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope, CONTACT);
			expect(result).toEqual(FAKE_CANDIDATE);
			expect(mockCreateDealCandidate).toHaveBeenCalled();
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────────

	describe('edge cases', () => {
		it('returns null for empty string', async () => {
			const result = await extractDealCandidate('', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
			expect(mockInferWithGemini).not.toHaveBeenCalled();
		});

		it('returns null for whitespace only', async () => {
			const result = await extractDealCandidate('   ', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
			expect(mockInferWithGemini).not.toHaveBeenCalled();
		});

		it('trims input before sending to Gemini', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('  term sheet $1M  ', CHAT, MSG, WS, testEnvelope);
			expect(mockInferWithGemini).toHaveBeenCalledWith(
				expect.objectContaining({ userPrompt: 'term sheet $1M' }),
			);
		});

		it('truncates dealTitleGuess to 200 chars', async () => {
			const longTitle = 'A'.repeat(300);
			geminiReturns({ ...VALID_EXTRACTION, dealTitleGuess: longTitle });
			await extractDealCandidate('test $1M', CHAT, MSG, WS, testEnvelope);
			const call = mockCreateDealCandidate.mock.calls[0];
			expect(call[1].dealTitleGuess).toHaveLength(200);
		});
	});

	// ─── Error handling ──────────────────────────────────────────────────────

	describe('error handling', () => {
		it('returns null on invalid JSON from Gemini', async () => {
			mockInferWithGemini.mockResolvedValueOnce('not valid json');
			const result = await extractDealCandidate('SAFT $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
			expect(mockCreateDealCandidate).not.toHaveBeenCalled();
		});

		it('returns null when response has wrong shape', async () => {
			mockInferWithGemini.mockResolvedValueOnce(JSON.stringify({ answer: 'yes' }));
			const result = await extractDealCandidate('SAFT $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
		});

		it('returns null when dealTitleGuess is missing', async () => {
			mockInferWithGemini.mockResolvedValueOnce(
				JSON.stringify({ dealTypeGuess: 'saft', confidence: 0.9, signals: ['test'] }),
			);
			const result = await extractDealCandidate('SAFT $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
		});

		it('returns null when signals is not an array', async () => {
			mockInferWithGemini.mockResolvedValueOnce(
				JSON.stringify({
					dealTitleGuess: 'test',
					dealTypeGuess: 'saft',
					confidence: 0.9,
					signals: 'not array',
				}),
			);
			const result = await extractDealCandidate('SAFT $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
		});

		it('returns null when DAL insert fails', async () => {
			geminiReturns(VALID_EXTRACTION);
			mockCreateDealCandidate.mockRejectedValueOnce(new Error('DB insert failed'));
			const result = await extractDealCandidate('SAFT $1M', CHAT, MSG, WS, testEnvelope);
			expect(result).toBeNull();
		});
	});

	// ─── System prompt ───────────────────────────────────────────────────────

	describe('system prompt', () => {
		it('instructs extraction of required fields', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('test', CHAT, MSG, WS, testEnvelope);
			const call = mockInferWithGemini.mock.calls[0][0];
			expect(call.systemPrompt).toContain('dealTitleGuess');
			expect(call.systemPrompt).toContain('dealTypeGuess');
			expect(call.systemPrompt).toContain('confidence');
			expect(call.systemPrompt).toContain('signals');
		});

		it('instructs JSON-only response', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('test', CHAT, MSG, WS, testEnvelope);
			const call = mockInferWithGemini.mock.calls[0][0];
			expect(call.systemPrompt).toContain('ONLY a JSON object');
		});

		it('lists valid deal types', async () => {
			geminiReturns(VALID_EXTRACTION);
			await extractDealCandidate('test', CHAT, MSG, WS, testEnvelope);
			const call = mockInferWithGemini.mock.calls[0][0];
			expect(call.systemPrompt).toContain('saft');
			expect(call.systemPrompt).toContain('equity');
			expect(call.systemPrompt).toContain('token_warrant');
		});
	});
});

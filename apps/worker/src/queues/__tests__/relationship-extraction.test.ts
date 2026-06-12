import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createConnection: vi.fn(),
	createIntroduction: vi.fn(),
	createRelationship: vi.fn(),
	detectConnections: vi.fn(),
	detectIntroductions: vi.fn(),
	extractRelationships: vi.fn(),
	listContactMaskingAliases: vi.fn(),
	getMemoriesByContact: vi.fn(),
	getWorkspaceConnectionKeywords: vi.fn(),
	getWorkspaceIntroKeywords: vi.fn(),
	hasUserAiAnalysisConsent: vi.fn(),
	hasConnectionKeywords: vi.fn(),
	hasIntroKeywords: vi.fn(),
	maskContactAliases: vi.fn(),
	processor: undefined as
		| undefined
		| ((job: { data: Record<string, unknown> }) => Promise<unknown>),
	queueGetJobs: vi.fn(),
	searchContactByName: vi.fn(),
	withWorkspaceRLS: vi.fn(),
}));

vi.mock('@repo/crypto', () => ({
	decrypt: vi.fn((content: string) => content.replace(/^enc:/, '')),
	deriveKeys: vi.fn(() => Promise.resolve({ dek: Buffer.alloc(32) })),
	generatePersonPseudonym: vi.fn((contactId: string) => {
		if (contactId.endsWith('1')) return 'PERSON_alice';
		if (contactId.endsWith('2')) return 'PERSON_bob';
		if (contactId.endsWith('3')) return 'PERSON_carol';
		return 'PERSON_unknown';
	}),
	maskContactAliases: mocks.maskContactAliases,
	unwrapWrk: vi.fn(() => Promise.resolve(Buffer.alloc(32))),
}));

vi.mock('@repo/db', () => ({
	createConnection: mocks.createConnection,
	createIntroduction: mocks.createIntroduction,
	createRelationship: mocks.createRelationship,
	listContactMaskingAliases: mocks.listContactMaskingAliases,
	getMemoriesByContact: mocks.getMemoriesByContact,
	getWorkspaceConnectionKeywords: mocks.getWorkspaceConnectionKeywords,
	getWorkspaceIntroKeywords: mocks.getWorkspaceIntroKeywords,
	hasUserAiAnalysisConsent: mocks.hasUserAiAnalysisConsent,
	searchContactByName: mocks.searchContactByName,
	withWorkspaceRLS: mocks.withWorkspaceRLS,
}));

vi.mock('bullmq', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Queue: vi.fn().mockImplementation(function () {
		return { add: vi.fn(), getJobs: mocks.queueGetJobs, on: vi.fn() };
	}),
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Worker: vi.fn().mockImplementation(function (_name: string, processor: typeof mocks.processor) {
		mocks.processor = processor;
		return { on: vi.fn() };
	}),
}));

vi.mock('../../ai/connection-detection', () => ({
	detectConnections: mocks.detectConnections,
	hasConnectionKeywords: mocks.hasConnectionKeywords,
}));

vi.mock('../../ai/introduction-detection', () => ({
	detectIntroductions: mocks.detectIntroductions,
	hasIntroKeywords: mocks.hasIntroKeywords,
}));

vi.mock('../../ai/relationship-extraction', () => ({
	extractRelationships: mocks.extractRelationships,
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

const relationshipModule = await import('../relationship-extraction');

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const USER = 'user-00000000-0000-0000-0000-000000000001';
const CONTACT_A = 'contact-00000000-0000-0000-0000-000000000001';
const CONTACT_B = 'contact-00000000-0000-0000-0000-000000000002';
const CONTACT_C = 'contact-00000000-0000-0000-0000-000000000003';
const MSG_1 = 'msg-00000000-0000-0000-0000-000000000001';
const MSG_2 = 'msg-00000000-0000-0000-0000-000000000002';
const MSG_3 = 'msg-00000000-0000-0000-0000-000000000003';
const fakeKeyEnvelope = {
	encryptedWrk: Buffer.from('key').toString('base64'),
	kmsContext: { workspaceId: WS },
	wrkVersion: 1,
};

describe('relationship extraction intro provenance', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getMemoriesByContact.mockResolvedValue([
			{ contentSanitized: 'old memory says Alice should introduce Bob and Carol' },
		]);
		mocks.listContactMaskingAliases.mockResolvedValue([
			{ id: CONTACT_A, firstName: 'Alice', lastName: 'Adams', username: 'alicea' },
			{ id: CONTACT_B, firstName: 'Bob', lastName: 'Baker', username: 'bobb' },
			{ id: CONTACT_C, firstName: 'Carol', lastName: 'Clark', username: 'carolc' },
		]);
		mocks.maskContactAliases.mockImplementation(
			(
				text: string,
				_salt: Buffer,
				contacts: Array<{
					contactId: string;
					firstName?: string;
					lastName?: string;
					fullName?: string;
					username?: string;
				}>,
			) => {
				let maskedText = text;
				const aliasMap: Array<{
					alias: string;
					matchedText: string;
					contactId: string;
					pseudonym: string;
					kind: string;
				}> = [];
				for (const contact of contacts) {
					const pseudonym = `PERSON_${contact.firstName?.toLowerCase()}`;
					const aliases = [
						contact.fullName,
						contact.firstName,
						contact.lastName,
						contact.username,
						contact.username ? `@${contact.username}` : undefined,
					].filter((alias): alias is string => Boolean(alias));
					let matchedText: string | undefined;
					for (const alias of aliases.sort((a, b) => b.length - a.length)) {
						const pattern = new RegExp(
							`(?<![A-Za-z0-9_])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`,
							'gi',
						);
						maskedText = maskedText.replace(pattern, (match) => {
							matchedText ??= match;
							return pseudonym;
						});
					}
					if (matchedText) {
						aliasMap.push({
							alias: matchedText,
							matchedText,
							contactId: contact.contactId,
							pseudonym,
							kind: 'fullName',
						});
					}
				}
				return { maskedText, entityMap: [], aliasMap };
			},
		);
		mocks.getWorkspaceIntroKeywords.mockResolvedValue([]);
		mocks.getWorkspaceConnectionKeywords.mockResolvedValue([]);
		mocks.hasUserAiAnalysisConsent.mockResolvedValue(true);
		mocks.extractRelationships.mockResolvedValue([]);
		mocks.withWorkspaceRLS.mockImplementation(
			async (_workspaceId: string, fn: () => Promise<unknown>) => fn(),
		);
		mocks.hasConnectionKeywords.mockReturnValue(false);
		mocks.hasIntroKeywords.mockReturnValue(true);
		mocks.queueGetJobs.mockResolvedValue([]);
		mocks.searchContactByName.mockImplementation((_workspaceId: string, name: string) => {
			const contacts: Record<string, Array<{ id: string }>> = {
				Alice: [{ id: CONTACT_A }],
				Bob: [{ id: CONTACT_B }],
				Carol: [{ id: CONTACT_C }],
			};
			return Promise.resolve(contacts[name] ?? []);
		});
	});

	it('does not hold workspace RLS while running local relationship model calls', async () => {
		let rlsDepth = 0;
		mocks.withWorkspaceRLS.mockImplementation(
			async (_workspaceId: string, fn: () => Promise<unknown>) => {
				rlsDepth++;
				try {
					return await fn();
				} finally {
					rlsDepth--;
				}
			},
		);
		mocks.extractRelationships.mockImplementation(async () => {
			expect(rlsDepth).toBe(0);
			return [];
		});
		mocks.detectIntroductions.mockImplementation(async () => {
			expect(rlsDepth).toBe(0);
			return [];
		});

		const processor = mocks.processor;
		expect(processor).toBeDefined();
		if (!processor) throw new Error('relationship extraction processor was not registered');
		await processor({
			data: {
				workspaceId: WS,
				userId: USER,
				sourceAccountId: 'tg-account-1',
				contactId: CONTACT_A,
				keyEnvelope: fakeKeyEnvelope,
				workspaceSalt: Buffer.from('salt').toString('hex'),
				messages: [
					{
						role: 'assistant',
						content: 'enc:Alice, meet Bob.',
						timestamp: '2026-05-14T10:00:00Z',
						sourceMessageId: MSG_1,
						chatId: 'chat-1',
						contactId: CONTACT_A,
					},
				],
			},
		});

		expect(mocks.extractRelationships).toHaveBeenCalled();
		expect(mocks.detectIntroductions).toHaveBeenCalled();
		expect(mocks.withWorkspaceRLS).toHaveBeenCalledWith(WS, expect.any(Function));
	});

	it('detects intros from the fresh batch and stores validated source message IDs', async () => {
		mocks.detectIntroductions.mockResolvedValue([
			{
				introducer_ref: 'PERSON_alice',
				introduced_ref_1: 'PERSON_bob',
				introduced_ref_2: 'PERSON_carol',
				context: 'deal',
				confidence: 0.92,
				reasoning: 'PERSON_alice explicitly introduced PERSON_bob and PERSON_carol.',
				source_message_ids: [MSG_2, 'not-from-this-batch'],
			},
		]);

		const processor = mocks.processor;
		expect(processor).toBeDefined();
		if (!processor) throw new Error('relationship extraction processor was not registered');
		const result = await processor({
			data: {
				workspaceId: WS,
				userId: USER,
				sourceAccountId: 'tg-account-1',
				contactId: CONTACT_A,
				keyEnvelope: fakeKeyEnvelope,
				workspaceSalt: Buffer.from('salt').toString('hex'),
				messages: [
					{
						role: 'assistant',
						content: 'enc:General catch-up with @unknownhandle, no intro.',
						timestamp: '2026-05-14T10:00:00Z',
						sourceMessageId: MSG_1,
						chatId: 'chat-1',
						contactId: CONTACT_B,
					},
					{
						role: 'assistant',
						content: 'enc:Alice, meet Bob. Bob, Carol is the right investor.',
						timestamp: '2026-05-14T10:01:00Z',
						sourceMessageId: MSG_2,
						chatId: 'chat-1',
						contactId: CONTACT_A,
					},
					{
						role: 'assistant',
						content: 'enc:Carol can help.',
						timestamp: '2026-05-14T10:02:00Z',
						sourceMessageId: MSG_3,
						chatId: 'chat-1',
						contactId: CONTACT_C,
					},
				],
			},
		});

		expect(mocks.detectIntroductions).toHaveBeenCalledWith(expect.stringContaining(MSG_2));
		const prompt = mocks.detectIntroductions.mock.calls[0]?.[0] as string;
		expect(prompt).toContain('[source:');
		expect(prompt).toContain('[speaker:PERSON_alice]');
		expect(prompt).toContain('PERSON_alice');
		expect(prompt).toContain('PERSON_bob');
		expect(prompt).toContain('PERSON_carol');
		expect(prompt).not.toContain('Alice');
		expect(prompt).not.toContain('Bob');
		expect(prompt).not.toContain('Carol');
		expect(prompt).not.toContain('@unknownhandle');
		expect(prompt).not.toContain('enc:');
		expect(mocks.listContactMaskingAliases).toHaveBeenCalledWith(
			WS,
			expect.anything(),
			expect.objectContaining({
				sourceAccountId: 'tg-account-1',
				includeLegacy: true,
			}),
		);
		expect(mocks.detectIntroductions).not.toHaveBeenCalledWith(
			expect.stringContaining('old memory'),
		);
		expect(mocks.searchContactByName).not.toHaveBeenCalled();
		expect(mocks.createIntroduction).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				introducerContactId: CONTACT_A,
				introducedContactId1: CONTACT_B,
				introducedContactId2: CONTACT_C,
				sourceMessageIds: [MSG_2],
				status: 'active',
			}),
			expect.anything(),
		);
		expect(result).toEqual(
			expect.objectContaining({
				introductionsDetected: 1,
				introductionsCreated: 1,
				introductionsRejected: 0,
				diagnostics: expect.objectContaining({
					freshSourceMessages: 3,
					introductionKeywordMatched: true,
					introductionModelCalls: 1,
				}),
			}),
		);
	});

	it.each([
		['missing source IDs', undefined],
		['invalid source IDs', ['not-from-this-batch']],
	])('does not attach all batch IDs for %s', async (_label, sourceMessageIds) => {
		mocks.detectIntroductions.mockResolvedValue([
			{
				introducer_ref: 'PERSON_alice',
				introduced_ref_1: 'PERSON_bob',
				introduced_ref_2: 'PERSON_carol',
				context: 'deal',
				confidence: 0.92,
				reasoning: 'PERSON_alice explicitly introduced PERSON_bob and PERSON_carol.',
				source_message_ids: sourceMessageIds,
			},
		]);

		const processor = mocks.processor;
		expect(processor).toBeDefined();
		if (!processor) throw new Error('relationship extraction processor was not registered');
		await processor({
			data: {
				workspaceId: WS,
				userId: USER,
				contactId: CONTACT_A,
				keyEnvelope: fakeKeyEnvelope,
				workspaceSalt: Buffer.from('salt').toString('hex'),
				messages: [
					{
						role: 'assistant',
						content: 'enc:Alice, meet Bob.',
						timestamp: '2026-05-14T10:00:00Z',
						sourceMessageId: MSG_1,
						chatId: 'chat-1',
						contactId: CONTACT_A,
					},
					{
						role: 'assistant',
						content: 'enc:Bob can review it.',
						timestamp: '2026-05-14T10:01:00Z',
						sourceMessageId: MSG_2,
						chatId: 'chat-1',
						contactId: CONTACT_B,
					},
					{
						role: 'assistant',
						content: 'enc:Carol is the right investor.',
						timestamp: '2026-05-14T10:02:00Z',
						sourceMessageId: MSG_3,
						chatId: 'chat-1',
						contactId: CONTACT_C,
					},
				],
			},
		});

		expect(mocks.createIntroduction).toHaveBeenCalledTimes(1);
		const introInput = mocks.createIntroduction.mock.calls[0]?.[1] as
			| { sourceMessageIds?: string[] }
			| undefined;
		expect(introInput?.sourceMessageIds).toBeUndefined();
		expect(introInput?.sourceMessageIds).not.toEqual([MSG_1, MSG_2, MSG_3]);
	});

	it('preserves capitalized intro verbs while redacting unknown person-like tokens', async () => {
		mocks.hasIntroKeywords.mockImplementation((content: string) => content.includes('Connect'));
		mocks.detectIntroductions.mockResolvedValue([
			{
				introducer_ref: 'PERSON_alice',
				introduced_ref_1: 'PERSON_bob',
				introduced_ref_2: 'PERSON_carol',
				context: 'knowledge',
				confidence: 0.75,
				reasoning: 'PERSON_alice used a direct Connect intro.',
				source_message_ids: [MSG_1],
			},
		]);

		const processor = mocks.processor;
		expect(processor).toBeDefined();
		if (!processor) throw new Error('relationship extraction processor was not registered');
		await processor({
			data: {
				workspaceId: WS,
				userId: USER,
				contactId: CONTACT_A,
				keyEnvelope: fakeKeyEnvelope,
				workspaceSalt: Buffer.from('salt').toString('hex'),
				messages: [
					{
						role: 'assistant',
						content: 'enc:Connect Alice with Bob and Carol near Demo Day.',
						timestamp: '2026-05-14T10:00:00Z',
						sourceMessageId: MSG_1,
						chatId: 'chat-1',
						contactId: CONTACT_A,
					},
				],
			},
		});

		const prompt = mocks.detectIntroductions.mock.calls[0]?.[0] as string;
		expect(prompt).toContain('Connect');
		expect(prompt).toContain('PERSON_alice');
		expect(prompt).toContain('PERSON_bob');
		expect(prompt).toContain('PERSON_carol');
		expect(prompt).toContain('PERSON_UNMAPPED_');
		expect(prompt).not.toContain('Alice');
		expect(prompt).not.toContain('Bob');
		expect(prompt).not.toContain('Carol');
		expect(prompt).not.toContain('Demo Day');
	});

	it('processes group batches without a contact-scoped memory lookup', async () => {
		mocks.detectIntroductions.mockResolvedValue([
			{
				introducer_ref: 'PERSON_alice',
				introduced_ref_1: 'PERSON_bob',
				introduced_ref_2: 'PERSON_carol',
				context: 'knowledge',
				confidence: 0.8,
				reasoning: 'Group message contains an explicit intro.',
				source_message_ids: [MSG_1],
			},
		]);

		const processor = mocks.processor;
		expect(processor).toBeDefined();
		if (!processor) throw new Error('relationship extraction processor was not registered');
		await processor({
			data: {
				workspaceId: WS,
				userId: USER,
				chatId: 'chat-group-1',
				chatType: 'supergroup',
				keyEnvelope: fakeKeyEnvelope,
				workspaceSalt: Buffer.from('salt').toString('hex'),
				messages: [
					{
						role: 'assistant',
						content: 'enc:Alice, meet Bob and Carol.',
						timestamp: '2026-05-14T10:00:00Z',
						sourceMessageId: MSG_1,
						chatId: 'chat-group-1',
						contactId: CONTACT_A,
					},
					{
						role: 'assistant',
						content: 'enc:Bob here.',
						timestamp: '2026-05-14T10:01:00Z',
						sourceMessageId: MSG_2,
						chatId: 'chat-group-1',
						contactId: CONTACT_B,
					},
					{
						role: 'assistant',
						content: 'enc:Carol here.',
						timestamp: '2026-05-14T10:02:00Z',
						sourceMessageId: MSG_3,
						chatId: 'chat-group-1',
						contactId: CONTACT_C,
					},
				],
			},
		});

		expect(mocks.getMemoriesByContact).not.toHaveBeenCalled();
		expect(mocks.createIntroduction).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				introducerContactId: CONTACT_A,
				introducedContactId1: CONTACT_B,
				introducedContactId2: CONTACT_C,
				sourceMessageIds: [MSG_1],
				status: 'triage',
			}),
			expect.anything(),
		);
	});

	it('detects new connections from fresh contact batches and stores grounded source IDs', async () => {
		mocks.getWorkspaceConnectionKeywords.mockResolvedValue(['vibed at']);
		mocks.hasConnectionKeywords.mockImplementation((content: string) =>
			content.includes('Great to meet'),
		);
		mocks.detectConnections.mockResolvedValue([
			{
				contact_name: 'PERSON_alice',
				event: 'ETHDenver',
				context: 'First met at ETHDenver.',
				confidence: 0.91,
				reasoning: 'Explicit first-meeting signal.',
				source_message_ids: [MSG_1, 'not-from-this-batch'],
			},
		]);

		const processor = mocks.processor;
		expect(processor).toBeDefined();
		if (!processor) throw new Error('relationship extraction processor was not registered');
		const result = await processor({
			data: {
				workspaceId: WS,
				userId: USER,
				sourceAccountId: 'tg-account-1',
				contactId: CONTACT_A,
				keyEnvelope: fakeKeyEnvelope,
				workspaceSalt: Buffer.from('salt').toString('hex'),
				messages: [
					{
						role: 'assistant',
						content: 'enc:Great to meet you at ETHDenver.',
						timestamp: '2026-05-14T10:00:00Z',
						sourceMessageId: MSG_1,
						chatId: 'chat-1',
						contactId: CONTACT_A,
					},
				],
			},
		});

		expect(mocks.getWorkspaceConnectionKeywords).toHaveBeenCalledWith(WS);
		expect(mocks.hasConnectionKeywords).toHaveBeenCalledWith(
			expect.stringContaining('Great to meet'),
			['vibed at'],
		);
		expect(mocks.detectConnections).toHaveBeenCalledWith(expect.stringContaining(MSG_1));
		const prompt = mocks.detectConnections.mock.calls[0]?.[0] as string;
		expect(prompt).toContain('[speaker:PERSON_alice]');
		expect(mocks.createConnection).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				contactId: CONTACT_A,
				event: 'ETHDenver',
				context: 'First met at ETHDenver.',
				confidence: 0.91,
				sourceMessageIds: [MSG_1],
			}),
			expect.anything(),
		);
		expect(result).toEqual(
			expect.objectContaining({
				connectionsDetected: 1,
				connectionsCreated: 1,
				connectionsRejected: 0,
				diagnostics: expect.objectContaining({
					connectionKeywordMatched: true,
					connectionModelCalls: 1,
				}),
			}),
		);
	});

	it('classifies and clears resolved retained relationship extraction failures', async () => {
		const removeResolved = vi.fn();
		const removeStalled = vi.fn();
		mocks.queueGetJobs.mockResolvedValueOnce([
			{
				data: { workspaceId: WS, userId: USER, contactId: CONTACT_A },
				failedReason: 'Failed query: select "connection_keywords" from "user_preferences"',
				remove: removeResolved,
				timestamp: Date.now(),
			},
			{
				data: { workspaceId: WS, userId: USER, contactId: CONTACT_B },
				failedReason: 'job stalled more than allowable limit',
				remove: removeStalled,
				timestamp: Date.now(),
			},
		]);

		const result = await relationshipModule.cleanupResolvedRelationshipExtractionFailures({
			workspaceId: WS,
			userId: USER,
		});

		expect(result).toEqual(
			expect.objectContaining({
				scanned: 2,
				removed: 1,
				retained: 1,
			}),
		);
		expect(removeResolved).toHaveBeenCalledTimes(1);
		expect(removeStalled).not.toHaveBeenCalled();
	});

	it('keeps relationship extraction concurrency conservative and bounded', () => {
		expect(relationshipModule.relationshipExtractionConcurrency({})).toBe(1);
		expect(
			relationshipModule.relationshipExtractionConcurrency({
				RELATIONSHIP_EXTRACTION_CONCURRENCY: '2',
			}),
		).toBe(2);
		expect(
			relationshipModule.relationshipExtractionConcurrency({
				RELATIONSHIP_EXTRACTION_CONCURRENCY: '999',
			}),
		).toBe(4);
		expect(
			relationshipModule.relationshipExtractionConcurrency({
				RELATIONSHIP_EXTRACTION_CONCURRENCY: 'not-a-number',
			}),
		).toBe(1);
	});
});

import { vi } from 'vitest';
import type { KnowledgeSearchResultWithEvidence } from '../../dal/knowledge';
import { knowledgeRecallFixture } from './knowledge-recall-fixture';

const fixture = knowledgeRecallFixture;

const selectQueue = vi.hoisted((): unknown[][] => []);
const executeQueue = vi.hoisted((): unknown[][] => []);

function makeSelectChain(rows: unknown[]) {
	const terminal = () =>
		Object.assign(Promise.resolve(rows), {
			limit: vi.fn(() => Promise.resolve(rows)),
			offset: vi.fn(() => Promise.resolve(rows)),
		});
	const chain = {
		from: vi.fn(() => chain),
		innerJoin: vi.fn(() => chain),
		where: vi.fn(() => chain),
		orderBy: vi.fn(() => terminal()),
		limit: vi.fn(() => Promise.resolve(rows)),
		offset: vi.fn(() => Promise.resolve(rows)),
	};
	return chain;
}

const mockSetLocal = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const mockExecute = vi.hoisted(() => vi.fn(() => Promise.resolve(executeQueue.shift() ?? [])));
const mockSelect = vi.hoisted(() => vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])));
const mockTransaction = vi.hoisted(() =>
	vi.fn((fn: (tx: unknown) => unknown) =>
		Promise.resolve(
			fn({
				execute: mockSetLocal,
				select: mockSelect,
			}),
		),
	),
);

vi.mock('../../client', () => ({
	db: {
		select: mockSelect,
		execute: mockExecute,
		transaction: mockTransaction,
	},
}));

const mockWithKeys = vi.hoisted(() => vi.fn((_envelope: unknown, fn: () => unknown) => fn()));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
	computeBlindIndex: vi.fn((value: string) => `hash:${value}`),
	keyStore: { getStore: vi.fn(() => ({ bik: Buffer.from('fixture-bik') })) },
	getCurrentKeys: vi.fn(() => ({ bik: Buffer.from('fixture-bik') })),
}));

import { searchKnowledgeNodesWithEvidence } from '../../dal/knowledge';

export {
	knowledgeRecallFixture,
	mockExecute,
	mockSelect,
	mockSetLocal,
	mockTransaction,
	mockWithKeys,
};

export const recallHarnessEnvelope = {
	encryptedWrk: Buffer.from('fixture'),
	kmsContext: { workspaceId: fixture.workspaceId },
	wrkVersion: 1,
};

export interface FixtureSearchInput {
	query: string;
	workspaceId?: string;
	useEmbedding?: boolean;
	messageRecallQueryText?: string | null;
	limit?: number;
}

function normalizedMemoryScore(hit: { semanticScore: number; ftsRank: number; rrfScore: number }) {
	const ftsScore = hit.ftsRank > 0 ? Math.min(0.95, 0.72 + Math.min(hit.ftsRank, 1) * 0.2) : 0;
	const rrfScore = Math.min(0.88, hit.rrfScore * 10);
	return Math.max(hit.semanticScore, ftsScore, rrfScore);
}

function confidentMemoryHits(hits: ReturnType<typeof fixture.memoryHits>) {
	return hits.filter((hit) => hit.ftsRank > 0 || normalizedMemoryScore(hit) >= 0.62);
}

export function resetFixtureSearchMocks() {
	selectQueue.length = 0;
	executeQueue.length = 0;
	vi.clearAllMocks();
}

export async function runFixtureSearch(
	input: FixtureSearchInput,
): Promise<KnowledgeSearchResultWithEvidence[]> {
	const workspaceId = input.workspaceId ?? fixture.workspaceId;
	const query = input.query;
	const exactRows = fixture.exactRows(workspaceId, query);
	const aliasRows = fixture.aliasRows(workspaceId, query);
	const semanticRows = input.useEmbedding ? fixture.semanticRows(workspaceId, query) : [];
	const messageRecallQueryText =
		input.messageRecallQueryText === undefined ? query : input.messageRecallQueryText;
	const memoryHits = messageRecallQueryText
		? fixture.memoryHits(workspaceId, messageRecallQueryText)
		: [];
	const confidentHits = confidentMemoryHits(memoryHits);
	const recallRows =
		messageRecallQueryText && confidentHits.length > 0
			? fixture.recallRowsForMemoryHits(workspaceId, confidentHits)
			: [];

	selectQueue.push(exactRows, aliasRows);
	if (input.useEmbedding) selectQueue.push(semanticRows);
	if (messageRecallQueryText) {
		executeQueue.push(memoryHits);
		if (recallRows.length > 0) selectQueue.push(recallRows);
	}

	const finalNodeIds = new Set<string>();
	for (const row of exactRows) finalNodeIds.add(row.id);
	for (const row of aliasRows) finalNodeIds.add(row.id);
	for (const row of semanticRows) {
		if (row.similarity >= 0.62 || finalNodeIds.has(row.id)) finalNodeIds.add(row.id);
	}
	for (const row of recallRows) finalNodeIds.add(row.nodeId);

	if (finalNodeIds.size > 0) {
		const ids = [...finalNodeIds];
		selectQueue.push(
			fixture.contactRowsForNodes(workspaceId, ids),
			fixture.evidenceRowsForNodes(workspaceId, ids),
		);
	}

	return searchKnowledgeNodesWithEvidence(
		workspaceId,
		query,
		input.useEmbedding ? Array(512).fill(0.01) : undefined,
		recallHarnessEnvelope,
		{
			limit: input.limit ?? 5,
			messageRecallQueryText: messageRecallQueryText ?? undefined,
			minSimilarity: 0.62,
			minMessageRecallScore: 0.62,
		},
	);
}

import type { SealedEnvelope } from '@repo/crypto';
import { computeBlindIndex, keyStore, withKeys } from '@repo/crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { commitments } from '../schema/commitments';
import { contacts } from '../schema/contacts';
import { deals } from '../schema/deals';
import { searchContactByName } from './contacts';
import { hybridSearch, textSearch } from './memories';

export interface UnifiedSearchResult {
	contacts: Array<Record<string, unknown>>;
	memories: Array<{
		id: string;
		content: string;
		category: string;
		rrf_score: number;
	}>;
	commitments: Array<Record<string, unknown>>;
	deals: Array<Record<string, unknown>>;
}

type CommitmentSearchRow = {
	id: string;
	workspaceId: string;
	contactId: string;
	title: string;
	commitmentType: string;
	status: string;
	assignee: string;
	confidence: number;
	dueDate: Date | null;
	quote: string | null;
	fulfilledAt: Date | null;
	snoozedUntil: Date | null;
	createdAt: Date;
	updatedAt: Date;
	contactFirstName: string | null;
	contactLastName: string | null;
	contactUsername: string | null;
	lexical_score?: number;
};

const COMMITMENT_TEXT_SCAN_LIMIT = 500;

function normalizeSearchText(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/[^a-z0-9@._+-]+/g, ' ')
		.trim();
}

function tokenizeSearchQuery(query: string): string[] {
	return Array.from(
		new Set(
			normalizeSearchText(query)
				.split(/\s+/)
				.filter((term) => term.length >= 2),
		),
	).slice(0, 12);
}

function commitmentSearchScore(row: CommitmentSearchRow, query: string, terms: string[]): number {
	const normalizedQuery = normalizeSearchText(query);
	const title = normalizeSearchText(row.title);
	const quote = normalizeSearchText(row.quote);
	const contact = normalizeSearchText(
		[row.contactFirstName, row.contactLastName, row.contactUsername].filter(Boolean).join(' '),
	);
	const metadata = normalizeSearchText([row.commitmentType, row.status, row.assignee].join(' '));
	const searchable = [title, quote, contact, metadata].join(' ');
	if (!searchable) return 0;

	let score = 0;
	if (normalizedQuery && title.includes(normalizedQuery)) score += 10;
	if (normalizedQuery && quote.includes(normalizedQuery)) score += 5;
	if (normalizedQuery && contact.includes(normalizedQuery)) score += 4;
	if (normalizedQuery && searchable.includes(normalizedQuery)) score += 3;

	for (const term of terms) {
		if (title.includes(term)) score += 3;
		if (quote.includes(term)) score += 2;
		if (contact.includes(term)) score += 2;
		if (metadata.includes(term)) score += 1;
	}

	if (row.status === 'active') score += 0.5;
	if (row.dueDate) score += 0.25;
	return score;
}

function timeValue(value: Date | null | undefined): number {
	return value instanceof Date ? value.getTime() : 0;
}

function sortCommitmentSearchRows(a: CommitmentSearchRow, b: CommitmentSearchRow): number {
	const scoreDelta = (b.lexical_score ?? 0) - (a.lexical_score ?? 0);
	if (scoreDelta !== 0) return scoreDelta;

	const aDue = timeValue(a.dueDate);
	const bDue = timeValue(b.dueDate);
	if (aDue && bDue && aDue !== bDue) return aDue - bDue;
	if (aDue !== bDue) return bDue - aDue;

	return timeValue(b.createdAt) - timeValue(a.createdAt);
}

function mergeCommitmentResults(
	semanticResults: Array<Record<string, unknown>>,
	textResults: Array<Record<string, unknown>>,
	limit: number,
): Array<Record<string, unknown>> {
	const seen = new Set<string>();
	const merged: Array<Record<string, unknown>> = [];

	for (const row of [...semanticResults, ...textResults]) {
		const id = typeof row.id === 'string' ? row.id : undefined;
		if (id) {
			if (seen.has(id)) continue;
			seen.add(id);
		}
		merged.push(row);
		if (merged.length >= limit) break;
	}

	return merged;
}

async function searchCommitmentsByEmbedding(
	workspaceId: string,
	queryEmbedding: number[],
	envelope: SealedEnvelope,
	limit: number,
): Promise<Array<Record<string, unknown>>> {
	return withKeys(envelope, async () => {
		const embStr = `[${queryEmbedding.join(',')}]`;
		return db
			.select()
			.from(commitments)
			.where(and(eq(commitments.workspaceId, workspaceId), isNotNull(commitments.embedding)))
			.orderBy(sql`${commitments.embedding} <=> ${embStr}::halfvec(512)`)
			.limit(limit);
	});
}

async function searchCommitmentsByText(
	workspaceId: string,
	query: string,
	envelope: SealedEnvelope,
	limit: number,
): Promise<Array<Record<string, unknown>>> {
	const terms = tokenizeSearchQuery(query);
	if (terms.length === 0) return [];

	const scanLimit = Math.min(Math.max(limit * 25, 100), COMMITMENT_TEXT_SCAN_LIMIT);
	return withKeys(envelope, async () => {
		const rows = await db
			.select({
				id: commitments.id,
				workspaceId: commitments.workspaceId,
				contactId: commitments.contactId,
				title: commitments.title,
				commitmentType: commitments.commitmentType,
				status: commitments.status,
				assignee: commitments.assignee,
				confidence: commitments.confidence,
				dueDate: commitments.dueDate,
				quote: commitments.quote,
				fulfilledAt: commitments.fulfilledAt,
				snoozedUntil: commitments.snoozedUntil,
				createdAt: commitments.createdAt,
				updatedAt: commitments.updatedAt,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
				contactUsername: contacts.username,
			})
			.from(commitments)
			.leftJoin(
				contacts,
				and(
					eq(commitments.contactId, contacts.id),
					eq(commitments.workspaceId, contacts.workspaceId),
				),
			)
			.where(eq(commitments.workspaceId, workspaceId))
			.orderBy(sql`${commitments.createdAt} DESC`)
			.limit(scanLimit);

		return rows
			.map((row) => ({
				...row,
				lexical_score: commitmentSearchScore(row, query, terms),
			}))
			.filter((row) => row.lexical_score > 0)
			.sort(sortCommitmentSearchRows)
			.slice(0, limit);
	});
}

async function searchCommitments(
	workspaceId: string,
	query: string,
	envelope: SealedEnvelope,
	queryEmbedding: number[] | null,
	limit: number,
): Promise<Array<Record<string, unknown>>> {
	const [semanticResults, textResults] = await Promise.all([
		queryEmbedding
			? searchCommitmentsByEmbedding(workspaceId, queryEmbedding, envelope, limit).catch(() => [])
			: Promise.resolve([]),
		searchCommitmentsByText(workspaceId, query, envelope, limit).catch(() => []),
	]);
	return mergeCommitmentResults(semanticResults, textResults, limit);
}

export async function unifiedSearch(
	workspaceId: string,
	query: string,
	envelope: SealedEnvelope,
	queryEmbedding: number[] | null,
	options?: { limit?: number },
): Promise<UnifiedSearchResult> {
	const limit = options?.limit ?? 10;

	// Fan out searches in parallel
	const [contactResults, memoryResults, commitmentResults, dealResults] = await Promise.all([
		// 1. Contact search via blind index (exact name match)
		searchContactByName(workspaceId, query, envelope).catch(() => []),

		// 2. Memory search via hybrid RRF (requires embedding)
		queryEmbedding
			? hybridSearch(workspaceId, queryEmbedding, query, { limit }).catch(() => [])
			: textSearch(workspaceId, query, { limit }).catch(() => []),

		// 3. Commitment search via vector similarity plus bounded decrypted local text ranking.
		// SEC-ENC-502: title/quote/contact names are encrypted, so plaintext matching happens only
		// after Drizzle decrypts rows inside withKeys; ciphertext is never scanned with ILIKE.
		searchCommitments(workspaceId, query, envelope, queryEmbedding, limit).catch(() => []),

		// 4. Deal search via blind index exact match on title
		// SEC-ENC-502: title/notes encrypted — ILIKE impossible on ciphertext
		withKeys(envelope, async () => {
			const keys = keyStore.getStore();
			if (!keys) throw new Error('keyStore not initialized in search');
			const blindIdx = computeBlindIndex(query, keys.bik);
			return db
				.select()
				.from(deals)
				.where(and(eq(deals.workspaceId, workspaceId), eq(deals.titleBlindIndex, blindIdx)))
				.limit(limit);
		}).catch(() => []),
	]);

	return {
		contacts: Array.isArray(contactResults) ? contactResults : [],
		memories: memoryResults,
		commitments: commitmentResults,
		deals: dealResults,
	};
}

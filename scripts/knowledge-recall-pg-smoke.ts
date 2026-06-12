import { randomUUID } from 'node:crypto';
import { computeBlindIndex, deriveKeys, keyStore, type SealedEnvelope } from '@repo/crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { knowledgeRecallFixture as fixture } from '../packages/db/src/__tests__/fixtures/knowledge-recall-fixture';
import * as schema from '../packages/db/src/schema/index';

process.env.NODE_ENV ??= 'test';
process.env.DEV_KMS_BYPASS ??= 'true';

const configuredDatabaseUrl =
	process.env.KG_RECALL_PG_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

if (!configuredDatabaseUrl) {
	console.error(
		'Missing KG_RECALL_PG_DATABASE_URL or TEST_DATABASE_URL. Refusing to use DATABASE_URL for a destructive smoke fixture.',
	);
	console.error(
		'Run migrations against a throwaway test database, then run: KG_RECALL_PG_DATABASE_URL=postgres://... pnpm kg:recall:pg:smoke',
	);
	process.exit(2);
}

const databaseUrl = configuredDatabaseUrl;
process.env.DATABASE_URL = databaseUrl;
const client = postgres(databaseUrl, { prepare: false, max: 1 });
const db = drizzle(client, { schema });

const PRIMARY_USER_ID = '70000000-0000-4000-8000-000000000001';
const DECOY_USER_ID = '70000000-0000-4000-8000-000000000002';
const PRIMARY_CHAT_ID = '71000000-0000-4000-8000-000000000001';
const DECOY_CHAT_ID = '71000000-0000-4000-8000-000000000002';
const DEV_WRK = Buffer.alloc(32, 7);
const DEV_WRK_BASE64 = DEV_WRK.toString('base64');
const WORKSPACE_IDS = [fixture.workspaceId, fixture.decoyWorkspaceId] as const;
const VECTOR_DIMENSIONS = 512;
const MIN_SIMILARITY = 0.62;

interface SmokeCheck {
	name: string;
	status: 'passed' | 'failed';
	latencyMs: number;
	details?: string;
}

interface SmokeReport {
	suite: 'knowledge-recall-postgres-smoke';
	status: 'passed' | 'failed';
	database: 'configured test database';
	migrations: 'verified';
	totalChecks: number;
	passedChecks: number;
	failedChecks: number;
	averageLatencyMs: number;
	vectorRecall: 'passed' | 'failed';
	messageRecall: 'passed' | 'failed';
	evidenceEnrichment: 'passed' | 'failed';
	workspaceIsolation: 'passed' | 'failed';
	ambiguousMemorySkipping: 'passed' | 'failed';
	rlsMetadata: {
		enabledTables: string[];
		policies: string[];
		enforcementNote: string;
	};
	checks: SmokeCheck[];
}

function maskDatabaseUrl(value: string): string {
	return value.replace(/:[^:@/]+@/, ':***@');
}

function vector(values: Record<number, number>): number[] {
	const output = Array(VECTOR_DIMENSIONS).fill(0) as number[];
	for (const [index, value] of Object.entries(values)) {
		output[Number(index)] = value;
	}
	return output;
}

function nodeVector(nodeId: string): number[] {
	switch (nodeId) {
		case fixture.nodeIds.crmAutomation:
			return vector({ 0: 1 });
		case fixture.nodeIds.aiAgents:
			return vector({ 0: 0.82, 1: 0.57 });
		case fixture.nodeIds.baseL2:
			return vector({ 2: 0.74, 3: 0.67 });
		case fixture.nodeIds.ethereumL2:
			return vector({ 2: 0.72, 3: 0.69 });
		case fixture.nodeIds.solanaDepin:
			return vector({ 4: 1 });
		case fixture.nodeIds.helium:
			return vector({ 5: 1 });
		case fixture.nodeIds.graphite:
			return vector({ 6: 1 });
		case fixture.nodeIds.knowledgeGraph:
			return vector({ 7: 1 });
		case fixture.nodeIds.baseCase:
			return vector({ 8: 1 });
		default:
			return vector({ 9: 1 });
	}
}

function memoryVector(messageId: string): number[] {
	switch (messageId) {
		case fixture.messageIds[0]:
			return vector({ 0: 0.82, 1: 0.57 });
		case fixture.messageIds[2]:
			return vector({ 4: 1 });
		case fixture.messageIds[3]:
			return vector({ 5: 1 });
		case fixture.messageIds[4]:
			return vector({ 2: 0.74, 3: 0.67 });
		default:
			return vector({ 10: 1 });
	}
}

function queryVector(query: string): number[] | undefined {
	const normalized = query.toLowerCase();
	if (normalized === 'autonomous sales workflows') return vector({ 0: 1 });
	if (normalized === 'rollup migration') return vector({ 2: 1 });
	if (normalized === 'totally unrelated query') return vector({ 11: 1 });
	return undefined;
}

function envelopeFor(workspaceId: string): SealedEnvelope {
	return {
		encryptedWrk: DEV_WRK,
		kmsContext: { WorkspaceID: workspaceId, Purpose: 'workspace-root-key' },
		wrkVersion: 1,
	};
}

async function withWorkspaceKeys<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
	const keys = await deriveKeys(DEV_WRK, workspaceId, 1);
	return keyStore.run(keys, fn);
}

async function withWorkspaceSeedContext<T>(
	workspaceId: string,
	fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(drizzleSql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
		return withWorkspaceKeys(workspaceId, () => fn(tx as unknown as typeof db));
	});
}

async function verifyMigratedSchema() {
	const extensions = await client<{ extname: string }[]>`
		SELECT extname
		FROM pg_extension
		WHERE extname IN ('vector', 'pg_trgm', 'pgcrypto')
	`;
	const extensionSet = new Set(extensions.map((row) => row.extname));
	for (const required of ['vector', 'pg_trgm', 'pgcrypto']) {
		if (!extensionSet.has(required)) throw new Error(`missing required extension: ${required}`);
	}

	const [knowledgeEmbedding] = await client<{ data_type: string; udt_name: string }[]>`
		SELECT data_type, udt_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'knowledge_nodes'
			AND column_name = 'embedding'
	`;
	if (knowledgeEmbedding?.udt_name !== 'halfvec') {
		throw new Error(`knowledge_nodes.embedding is not halfvec: ${knowledgeEmbedding?.udt_name}`);
	}

	const [memoryEmbedding] = await client<{ udt_name: string }[]>`
		SELECT udt_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'memories'
			AND column_name = 'embedding'
	`;
	if (memoryEmbedding?.udt_name !== 'halfvec') {
		throw new Error(`memories.embedding is not halfvec: ${memoryEmbedding?.udt_name}`);
	}

	const [hybridSearch] = await client<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT 1
			FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'public'
				AND p.proname = 'hybrid_search'
		) AS exists
	`;
	if (!hybridSearch?.exists) throw new Error('missing hybrid_search function');

	const [knowledgeIndex] = await client<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT 1
			FROM pg_class
			WHERE relname = 'knowledge_nodes_embedding_idx'
		) AS exists
	`;
	if (!knowledgeIndex?.exists) throw new Error('missing knowledge_nodes_embedding_idx');
}

async function readRlsMetadata() {
	const tableRows = await client<{ relname: string }[]>`
		SELECT relname
		FROM pg_class
		WHERE relname IN (
			'knowledge_nodes',
			'knowledge_contacts',
			'knowledge_evidence',
			'memories',
			'messages',
			'contacts'
		)
			AND relrowsecurity = true
		ORDER BY relname
	`;
	const policyRows = await client<{ tablename: string; policyname: string }[]>`
		SELECT tablename, policyname
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename IN (
				'knowledge_nodes',
				'knowledge_contacts',
				'knowledge_evidence',
				'memories',
				'messages',
				'contacts'
			)
		ORDER BY tablename, policyname
	`;
	return {
		enabledTables: tableRows.map((row) => row.relname),
		policies: policyRows.map((row) => `${row.tablename}.${row.policyname}`),
		enforcementNote:
			'Smoke verifies RLS metadata and DAL workspace predicates; actual RLS enforcement may be bypassed by the migration owner role in local test databases.',
	};
}

async function cleanupFixtureRows() {
	for (const workspaceId of WORKSPACE_IDS) {
		await db.transaction(async (tx) => {
			await tx.execute(drizzleSql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
			await tx
				.delete(schema.knowledgeEvidence)
				.where(drizzleSql`${schema.knowledgeEvidence.workspaceId} = ${workspaceId}`);
			await tx
				.delete(schema.knowledgeContacts)
				.where(drizzleSql`${schema.knowledgeContacts.workspaceId} = ${workspaceId}`);
			await tx
				.delete(schema.knowledgeLinks)
				.where(drizzleSql`${schema.knowledgeLinks.workspaceId} = ${workspaceId}`);
			await tx
				.delete(schema.knowledgeNodes)
				.where(drizzleSql`${schema.knowledgeNodes.workspaceId} = ${workspaceId}`);
			await tx
				.delete(schema.memories)
				.where(drizzleSql`${schema.memories.workspaceId} = ${workspaceId}`);
			await tx
				.delete(schema.messages)
				.where(drizzleSql`${schema.messages.workspaceId} = ${workspaceId}`);
			await tx.delete(schema.chats).where(drizzleSql`${schema.chats.workspaceId} = ${workspaceId}`);
			await tx
				.delete(schema.contacts)
				.where(drizzleSql`${schema.contacts.workspaceId} = ${workspaceId}`);
			await tx
				.delete(schema.workspaceMembers)
				.where(drizzleSql`${schema.workspaceMembers.workspaceId} = ${workspaceId}`);
		});
	}

	await db
		.delete(schema.workspaces)
		.where(
			drizzleSql`${schema.workspaces.id} IN (${fixture.workspaceId}, ${fixture.decoyWorkspaceId})`,
		);
	await db
		.delete(schema.users)
		.where(drizzleSql`${schema.users.id} IN (${PRIMARY_USER_ID}, ${DECOY_USER_ID})`);
}

async function seedFixtureRows() {
	await cleanupFixtureRows();

	await db.insert(schema.users).values([
		{
			id: PRIMARY_USER_ID,
			email: 'knowledge-recall-primary@gordian.test',
			name: 'Knowledge Recall Primary',
			emailVerified: true,
		},
		{
			id: DECOY_USER_ID,
			email: 'knowledge-recall-decoy@gordian.test',
			name: 'Knowledge Recall Decoy',
			emailVerified: true,
		},
	]);

	await db.insert(schema.workspaces).values([
		{
			id: fixture.workspaceId,
			name: 'Knowledge Recall Smoke Primary',
			ownerId: PRIMARY_USER_ID,
			encryptedWrk: DEV_WRK_BASE64,
			kmsContext: { WorkspaceID: fixture.workspaceId, Purpose: 'workspace-root-key' },
			wrkVersion: 1,
		},
		{
			id: fixture.decoyWorkspaceId,
			name: 'Knowledge Recall Smoke Decoy',
			ownerId: DECOY_USER_ID,
			encryptedWrk: DEV_WRK_BASE64,
			kmsContext: { WorkspaceID: fixture.decoyWorkspaceId, Purpose: 'workspace-root-key' },
			wrkVersion: 1,
		},
	]);

	await db.insert(schema.workspaceMembers).values([
		{
			workspaceId: fixture.workspaceId,
			userId: PRIMARY_USER_ID,
			role: 'owner',
		},
		{
			workspaceId: fixture.decoyWorkspaceId,
			userId: DECOY_USER_ID,
			role: 'owner',
		},
	]);

	for (const workspaceId of WORKSPACE_IDS) {
		await withWorkspaceSeedContext(workspaceId, async (tx) => {
			await tx.insert(schema.chats).values({
				id: workspaceId === fixture.workspaceId ? PRIMARY_CHAT_ID : DECOY_CHAT_ID,
				workspaceId,
				telegramChatId: workspaceId === fixture.workspaceId ? 'kg-primary-chat' : 'kg-decoy-chat',
				type: 'private',
				title:
					workspaceId === fixture.workspaceId
						? 'Knowledge Recall Primary'
						: 'Knowledge Recall Decoy',
				username: workspaceId === fixture.workspaceId ? 'kg_primary' : 'kg_decoy',
			});

			const contacts = fixture.contacts.filter((contact) => contact.workspaceId === workspaceId);
			if (contacts.length > 0) {
				await tx.insert(schema.contacts).values(
					contacts.map((contact, index) => ({
						id: contact.id,
						workspaceId: contact.workspaceId,
						telegramId: `kg-contact-${index + 1}`,
						firstName: contact.firstName,
						lastName: contact.lastName,
						firstNameBidx: contact.firstName,
						lastNameBidx: contact.lastName,
						messageCount: fixture.messages.filter((message) => message.contactId === contact.id)
							.length,
						lastMessageAt:
							fixture.messages
								.filter((message) => message.contactId === contact.id)
								.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]?.occurredAt ??
							null,
					})),
				);
			}

			const messages = fixture.messages.filter((message) => message.workspaceId === workspaceId);
			if (messages.length > 0) {
				await tx.insert(schema.messages).values(
					messages.map((message, index) => ({
						id: message.id,
						workspaceId: message.workspaceId,
						chatId: workspaceId === fixture.workspaceId ? PRIMARY_CHAT_ID : DECOY_CHAT_ID,
						contactId: message.contactId,
						telegramMessageId: `kg-${workspaceId.slice(0, 8)}-${index + 1}`,
						text: message.text,
						isOutgoing: false,
						sentAt: message.occurredAt,
						createdAt: message.occurredAt,
					})),
				);
			}

			const memories = fixture.memories.filter((memory) => memory.workspaceId === workspaceId);
			if (memories.length > 0) {
				await tx.insert(schema.memories).values(
					memories.map((memory) => ({
						id: memory.id,
						workspaceId: memory.workspaceId,
						contactId: memory.contactId,
						category: memory.category as (typeof schema.memoryCategoryEnum.enumValues)[number],
						content: memory.contentSanitized,
						contentSanitized: memory.contentSanitized,
						embedding: memoryVector(
							typeof memory.metadata.messageId === 'string'
								? memory.metadata.messageId
								: typeof memory.metadata.message_id === 'string'
									? memory.metadata.message_id
									: typeof memory.metadata.sourceMessageId === 'string'
										? memory.metadata.sourceMessageId
										: '',
						),
						metadata: memory.metadata,
						createdAt: memory.createdAt,
						updatedAt: memory.createdAt,
					})),
				);
			}

			const nodes = fixture.nodes.filter((node) => node.workspaceId === workspaceId);
			if (nodes.length > 0) {
				const keys = await deriveKeys(DEV_WRK, workspaceId, 1);
				await tx.insert(schema.knowledgeNodes).values(
					nodes.map((node) => ({
						id: node.id,
						workspaceId: node.workspaceId,
						type: node.type as (typeof schema.knowledgeNodeTypeEnum.enumValues)[number],
						name: node.name,
						displayName: node.displayName,
						description: node.description,
						nameBlindIndex: node.name,
						aliases: node.aliases,
						embedding: nodeVector(node.id),
						mentionCount: node.mentionCount,
						firstSeenAt: node.firstSeenAt,
						lastSeenAt: node.lastSeenAt,
						createdAt: node.createdAt,
					})),
				);

				// Seed direct SQL fixtures with the actual persisted blind-index values.
				for (const node of nodes) {
					await tx.execute(drizzleSql`
							UPDATE knowledge_nodes
							SET name_blind_index = ${computeBlindIndex(node.name, keys.bik)}
							WHERE workspace_id = ${workspaceId} AND id = ${node.id}
						`);
				}
			}

			const contactLinks = fixture.knowledgeContacts.filter(
				(link) => link.workspaceId === workspaceId,
			);
			if (contactLinks.length > 0) {
				await tx.insert(schema.knowledgeContacts).values(
					contactLinks.map((link) => ({
						id: randomUUID(),
						workspaceId: link.workspaceId,
						knowledgeNodeId: link.nodeId,
						contactId: link.contactId,
						relationType:
							link.relationType as (typeof schema.knowledgeContactRelTypeEnum.enumValues)[number],
						strength: link.strength,
						evidenceCount: link.evidenceCount,
						lastEvidenceAt: link.lastEvidenceAt,
						createdAt: link.lastEvidenceAt,
					})),
				);
			}

			const evidenceRows = fixture.evidence.filter(
				(evidence) => evidence.workspaceId === workspaceId,
			);
			if (evidenceRows.length > 0) {
				await tx.insert(schema.knowledgeEvidence).values(
					evidenceRows.map((evidence) => ({
						id: evidence.id,
						workspaceId: evidence.workspaceId,
						knowledgeNodeId: evidence.knowledgeNodeId,
						contactId: evidence.contactId,
						messageId: evidence.messageId,
						relationType: evidence.relationType,
						evidenceKind:
							evidence.evidenceKind as (typeof schema.knowledgeEvidenceKindEnum.enumValues)[number],
						confidence: evidence.confidence,
						snippet: evidence.snippet,
						occurredAt: evidence.occurredAt,
						metadata: { source: 'knowledge_recall_pg_smoke' },
						createdAt: evidence.createdAt,
					})),
				);
			}
		});
	}
}

function fail(message: string): never {
	throw new Error(message);
}

function assertTopNode(
	name: string,
	results: Awaited<ReturnType<typeof runSearch>>,
	expectedNodeId: string,
) {
	if (results[0]?.node.id !== expectedNodeId) {
		fail(`${name}: expected top node ${expectedNodeId}, got ${results[0]?.node.id ?? 'none'}`);
	}
}

function assertEvidence(
	result: Awaited<ReturnType<typeof runSearch>>[number] | undefined,
	name: string,
) {
	if (!result) fail(`${name}: missing result`);
	if (result.evidenceCount < 1) fail(`${name}: missing evidence count`);
	if (result.connectedContactCount < 1) fail(`${name}: missing connected contacts`);
	if (!result.evidence.some((row) => row.snippet)) fail(`${name}: missing evidence snippet`);
	if (!result.evidence.some((row) => row.occurredAt || row.createdAt)) {
		fail(`${name}: missing evidence timestamp`);
	}
	if (!result.evidence.some((row) => typeof row.confidence === 'number')) {
		fail(`${name}: missing evidence confidence`);
	}
	if (!result.evidence.some((row) => row.relationType)) fail(`${name}: missing relation label`);
}

async function runSearch(input: {
	query: string;
	embeddingQuery?: string;
	messageRecallQueryText?: string | null;
	workspaceId?: string;
}) {
	const { searchKnowledgeNodesWithEvidence } = await import('../packages/db/src/dal/knowledge');
	const workspaceId = input.workspaceId ?? fixture.workspaceId;
	return searchKnowledgeNodesWithEvidence(
		workspaceId,
		input.query,
		input.embeddingQuery ? queryVector(input.embeddingQuery) : queryVector(input.query),
		envelopeFor(workspaceId),
		{
			limit: 5,
			messageRecallQueryText:
				input.messageRecallQueryText === null
					? undefined
					: (input.messageRecallQueryText ?? input.query),
			minSimilarity: MIN_SIMILARITY,
			minMessageRecallScore: MIN_SIMILARITY,
			evidenceLimitPerNode: 3,
			contactLimitPerNode: 3,
		},
	);
}

async function timedCheck(name: string, fn: () => Promise<void>): Promise<SmokeCheck> {
	const startedAt = performance.now();
	try {
		await fn();
		return {
			name,
			status: 'passed',
			latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
		};
	} catch (error) {
		return {
			name,
			status: 'failed',
			latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

async function runSmokeChecks(): Promise<SmokeCheck[]> {
	const checks: SmokeCheck[] = [];

	checks.push(
		await timedCheck('exact recall', async () => {
			const results = await runSearch({ query: 'AI agents', messageRecallQueryText: null });
			assertTopNode('exact recall', results, fixture.nodeIds.aiAgents);
			if (!results[0]?.exactMatch) fail('exact recall: exactMatch was false');
			assertEvidence(results[0], 'exact recall');
		}),
	);

	checks.push(
		await timedCheck('alias recall', async () => {
			const results = await runSearch({ query: 'DePIN infra' });
			assertTopNode('alias recall', results, fixture.nodeIds.solanaDepin);
			if (!results[0]?.aliasMatch) fail('alias recall: aliasMatch was false');
			if (!results[0]?.matchReasons.includes('alias')) fail('alias recall: missing alias reason');
			assertEvidence(results[0], 'alias recall');
		}),
	);

	checks.push(
		await timedCheck('vector recall and threshold', async () => {
			const results = await runSearch({
				query: 'autonomous sales workflows',
				messageRecallQueryText: null,
			});
			assertTopNode('vector recall', results, fixture.nodeIds.crmAutomation);
			if ((results[0]?.similarity ?? 0) < MIN_SIMILARITY) {
				fail(`vector recall: similarity below threshold ${results[0]?.similarity}`);
			}
			const unrelated = await runSearch({
				query: 'totally unrelated query',
				messageRecallQueryText: null,
			});
			if (unrelated.length !== 0) fail('vector threshold: unrelated query returned results');
		}),
	);

	checks.push(
		await timedCheck('message recall and FTS', async () => {
			const results = await runSearch({ query: 'wireless hotspot rollout' });
			assertTopNode('message recall', results, fixture.nodeIds.helium);
			if ((results[0]?.messageHitCount ?? 0) < 1) fail('message recall: no message hits');
			if (!results[0]?.messageRecallReasons.includes('memory_full_text')) {
				fail('message recall: missing memory_full_text reason');
			}
			if (!results[0]?.messageMatchedEvidenceIds.includes(fixture.evidenceIds.helium)) {
				fail('message recall: expected evidence id not matched');
			}
			assertEvidence(results[0], 'message recall');
		}),
	);

	checks.push(
		await timedCheck('combined node and message recall', async () => {
			const results = await runSearch({
				query: 'rollup migration',
				messageRecallQueryText: 'consumer payments rollout',
			});
			assertTopNode('combined recall', results, fixture.nodeIds.baseL2);
			if (!results[0]?.matchReasons.includes('semantic similarity')) {
				fail('combined recall: missing semantic similarity reason');
			}
			if (!results[0]?.matchReasons.includes('matched in message evidence')) {
				fail('combined recall: missing message evidence reason');
			}
			if (results[1]?.node.id !== fixture.nodeIds.ethereumL2) {
				fail(`combined recall: expected Ethereum L2 second, got ${results[1]?.node.id ?? 'none'}`);
			}
			if ((results[0]?.matchScore ?? 0) <= (results[1]?.matchScore ?? 0)) {
				fail('combined recall: boosted node did not outrank node-only match');
			}
		}),
	);

	checks.push(
		await timedCheck('ambiguous memory skipping', async () => {
			for (const query of [
				'ambiguous base',
				'keyword only crm',
				'contact timestamp crm',
				'unmatched source message memory',
			]) {
				const results = await runSearch({ query });
				if (results.length !== 0) fail(`${query}: expected no results, got ${results.length}`);
			}
		}),
	);

	checks.push(
		await timedCheck('workspace isolation', async () => {
			const primary = await runSearch({ query: 'AI agents', workspaceId: fixture.workspaceId });
			assertTopNode('workspace isolation primary', primary, fixture.nodeIds.aiAgents);
			const primaryPayload = JSON.stringify(primary);
			if (primaryPayload.includes('Decoy workspace'))
				fail('workspace isolation: decoy snippet leaked');
			if (primaryPayload.includes(fixture.decoyWorkspaceId)) {
				fail('workspace isolation: decoy workspace id leaked');
			}

			const decoy = await runSearch({ query: 'AI agents', workspaceId: fixture.decoyWorkspaceId });
			assertTopNode('workspace isolation decoy', decoy, fixture.nodeIds.decoyAiAgents);
		}),
	);

	checks.push(
		await timedCheck('result payload safety', async () => {
			const results = await runSearch({ query: 'AI agents', messageRecallQueryText: null });
			const payload = JSON.stringify(results);
			if (payload.includes('"embedding"')) fail('payload safety: embedding leaked');
			if (payload.includes('555-0101') || payload.includes('alice@example.com')) {
				fail('payload safety: private raw-message detail leaked');
			}
		}),
	);

	return checks;
}

function categoryStatus(checks: SmokeCheck[], names: string[]): 'passed' | 'failed' {
	return checks.some((check) => names.includes(check.name) && check.status === 'failed')
		? 'failed'
		: 'passed';
}

function buildReport(checks: SmokeCheck[], rlsMetadata: SmokeReport['rlsMetadata']): SmokeReport {
	const failedChecks = checks.filter((check) => check.status === 'failed').length;
	const totalLatency = checks.reduce((sum, check) => sum + check.latencyMs, 0);
	return {
		suite: 'knowledge-recall-postgres-smoke',
		status: failedChecks > 0 ? 'failed' : 'passed',
		database: 'configured test database',
		migrations: 'verified',
		totalChecks: checks.length,
		passedChecks: checks.length - failedChecks,
		failedChecks,
		averageLatencyMs:
			checks.length === 0 ? 0 : Math.round((totalLatency / checks.length) * 100) / 100,
		vectorRecall: categoryStatus(checks, [
			'vector recall and threshold',
			'combined node and message recall',
		]),
		messageRecall: categoryStatus(checks, [
			'message recall and FTS',
			'combined node and message recall',
		]),
		evidenceEnrichment: categoryStatus(checks, [
			'exact recall',
			'alias recall',
			'message recall and FTS',
		]),
		workspaceIsolation: categoryStatus(checks, ['workspace isolation']),
		ambiguousMemorySkipping: categoryStatus(checks, ['ambiguous memory skipping']),
		rlsMetadata,
		checks,
	};
}

function printReport(report: SmokeReport) {
	console.log(`Knowledge recall Postgres smoke: ${report.status}`);
	console.log(`Database: ${report.database}`);
	console.log(`Migrations: ${report.migrations}`);
	console.log(`Queries: ${report.passedChecks}/${report.totalChecks} passed`);
	console.log(`Vector recall: ${report.vectorRecall}`);
	console.log(`Message recall: ${report.messageRecall}`);
	console.log(`Evidence enrichment: ${report.evidenceEnrichment}`);
	console.log(`Workspace isolation: ${report.workspaceIsolation}`);
	console.log(`Ambiguous memory skipping: ${report.ambiguousMemorySkipping}`);
	console.log(`Average latency: ${report.averageLatencyMs} ms`);
	console.log(`RLS metadata: ${report.rlsMetadata.enabledTables.length} tables enabled`);
	for (const check of report.checks) {
		if (check.status === 'failed') console.log(`- ${check.name}: ${check.details}`);
	}
	console.log(`KNOWLEDGE_RECALL_PG_SMOKE_JSON=${JSON.stringify(report)}`);
}

async function main() {
	console.log(`[kg:recall:pg:smoke] Database: ${maskDatabaseUrl(databaseUrl)}`);
	await verifyMigratedSchema();
	const rlsMetadata = await readRlsMetadata();
	try {
		await seedFixtureRows();
		const checks = await runSmokeChecks();
		const report = buildReport(checks, rlsMetadata);
		printReport(report);
		if (report.status !== 'passed') process.exitCode = 1;
	} finally {
		await cleanupFixtureRows();
	}
}

main()
	.catch((error) => {
		console.error('[kg:recall:pg:smoke] failed:', error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await client.end();
		process.exit(process.exitCode ?? 0);
	});

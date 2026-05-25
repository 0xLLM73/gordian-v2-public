const PRIMARY_WS = '10000000-0000-4000-8000-000000000001';
const DECOY_WS = '10000000-0000-4000-8000-000000000002';

type NodeType = 'topic' | 'project' | 'organization' | 'technology' | 'sector' | 'concept';
type RelationType =
	| 'knows_about'
	| 'works_on'
	| 'member_of'
	| 'expert_in'
	| 'uses'
	| 'interested_in';
type EvidenceKind = 'llm_extracted' | 'embedding_match' | 'contact_cooccurrence' | 'manual';

interface FixtureContact {
	id: string;
	workspaceId: string;
	firstName: string;
	lastName: string;
}

interface FixtureMessage {
	id: string;
	workspaceId: string;
	contactId: string;
	text: string;
	occurredAt: Date;
}

interface FixtureMemory {
	id: string;
	workspaceId: string;
	contactId: string | null;
	contentSanitized: string;
	category: string;
	metadata: Record<string, unknown>;
	createdAt: Date;
	semanticScore?: number;
	ftsRank?: number;
	rrfScore?: number;
}

interface FixtureNode {
	id: string;
	workspaceId: string;
	type: NodeType;
	name: string;
	displayName: string;
	description: string;
	nameBlindIndex: string;
	aliases: string[];
	mentionCount: number;
	firstSeenAt: Date;
	lastSeenAt: Date;
	createdAt: Date;
}

interface FixtureKnowledgeContact {
	workspaceId: string;
	nodeId: string;
	contactId: string;
	relationType: RelationType;
	strength: number;
	evidenceCount: number;
	lastEvidenceAt: Date;
}

interface FixtureEvidence {
	id: string;
	workspaceId: string;
	knowledgeNodeId: string;
	contactId: string;
	messageId: string;
	relationType: RelationType;
	evidenceKind: EvidenceKind;
	confidence: number;
	snippet: string;
	occurredAt: Date;
	createdAt: Date;
}

const d = (iso: string) => new Date(iso);
const hash = (name: string) => `hash:${name.toLowerCase()}`;

const contactIds = [
	'20000000-0000-4000-8000-000000000001',
	'20000000-0000-4000-8000-000000000002',
	'20000000-0000-4000-8000-000000000003',
	'20000000-0000-4000-8000-000000000004',
	'20000000-0000-4000-8000-000000000005',
	'20000000-0000-4000-8000-000000000006',
	'20000000-0000-4000-8000-000000000007',
	'20000000-0000-4000-8000-000000000008',
];

const messageIds = [
	'30000000-0000-4000-8000-000000000001',
	'30000000-0000-4000-8000-000000000002',
	'30000000-0000-4000-8000-000000000003',
	'30000000-0000-4000-8000-000000000004',
	'30000000-0000-4000-8000-000000000005',
	'30000000-0000-4000-8000-000000000006',
	'30000000-0000-4000-8000-000000000007',
	'30000000-0000-4000-8000-000000000008',
	'30000000-0000-4000-8000-000000000009',
	'30000000-0000-4000-8000-000000000010',
	'30000000-0000-4000-8000-000000000011',
	'30000000-0000-4000-8000-000000000012',
	'30000000-0000-4000-8000-000000000013',
	'30000000-0000-4000-8000-000000000014',
	'30000000-0000-4000-8000-000000000015',
	'30000000-0000-4000-8000-000000000016',
	'30000000-0000-4000-8000-000000000017',
	'30000000-0000-4000-8000-000000000018',
	'30000000-0000-4000-8000-000000000019',
	'30000000-0000-4000-8000-000000000020',
	'30000000-0000-4000-8000-000000000021',
	'30000000-0000-4000-8000-000000000022',
	'30000000-0000-4000-8000-000000000023',
	'30000000-0000-4000-8000-000000000024',
];

const nodeIds = {
	aiAgents: '40000000-0000-4000-8000-000000000001',
	crmAutomation: '40000000-0000-4000-8000-000000000002',
	solanaDepin: '40000000-0000-4000-8000-000000000003',
	helium: '40000000-0000-4000-8000-000000000004',
	baseL2: '40000000-0000-4000-8000-000000000005',
	ethereumL2: '40000000-0000-4000-8000-000000000006',
	graphite: '40000000-0000-4000-8000-000000000007',
	knowledgeGraph: '40000000-0000-4000-8000-000000000008',
	baseCase: '40000000-0000-4000-8000-000000000009',
	decoyAiAgents: '40000000-0000-4000-8000-000000000010',
};

const evidenceIds = {
	aiAgents: '50000000-0000-4000-8000-000000000001',
	crmAutomation: '50000000-0000-4000-8000-000000000002',
	solanaDepin: '50000000-0000-4000-8000-000000000003',
	helium: '50000000-0000-4000-8000-000000000004',
	baseL2: '50000000-0000-4000-8000-000000000005',
	ethereumL2: '50000000-0000-4000-8000-000000000006',
	graphite: '50000000-0000-4000-8000-000000000007',
	knowledgeGraph: '50000000-0000-4000-8000-000000000008',
	baseCase: '50000000-0000-4000-8000-000000000009',
	decoyAiAgents: '50000000-0000-4000-8000-000000000010',
};

const baseDate = d('2026-05-01T12:00:00.000Z');

const contacts: FixtureContact[] = [
	{ id: contactIds[0], workspaceId: PRIMARY_WS, firstName: 'Alice', lastName: 'Chen' },
	{ id: contactIds[1], workspaceId: PRIMARY_WS, firstName: 'Bob', lastName: 'Rivera' },
	{ id: contactIds[2], workspaceId: PRIMARY_WS, firstName: 'Carol', lastName: 'Singh' },
	{ id: contactIds[3], workspaceId: PRIMARY_WS, firstName: 'Dan', lastName: 'Okafor' },
	{ id: contactIds[4], workspaceId: PRIMARY_WS, firstName: 'Eve', lastName: 'Martin' },
	{ id: contactIds[5], workspaceId: PRIMARY_WS, firstName: 'Frank', lastName: 'Moore' },
	{ id: contactIds[6], workspaceId: PRIMARY_WS, firstName: 'Grace', lastName: 'Lee' },
	{ id: contactIds[7], workspaceId: PRIMARY_WS, firstName: 'Heidi', lastName: 'Patel' },
	{
		id: '20000000-0000-4000-8000-000000000101',
		workspaceId: DECOY_WS,
		firstName: 'Mallory',
		lastName: 'Decoy',
	},
];

const messages: FixtureMessage[] = [
	{
		id: messageIds[0],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[0],
		text: 'Alice said AI agents could automate CRM follow-ups for warm intros.',
		occurredAt: d('2026-05-02T09:00:00.000Z'),
	},
	{
		id: messageIds[1],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[1],
		text: 'Bob is testing CRM automation for investor updates and reminders.',
		occurredAt: d('2026-05-02T10:00:00.000Z'),
	},
	{
		id: messageIds[2],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[2],
		text: 'Carol mentioned DePIN infra on Solana for sensor networks.',
		occurredAt: d('2026-05-03T11:00:00.000Z'),
	},
	{
		id: messageIds[3],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[3],
		text: 'Dan is tracking Helium hotspots and community deployments.',
		occurredAt: d('2026-05-03T12:00:00.000Z'),
	},
	{
		id: messageIds[4],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[4],
		text: 'Eve asked whether Base L2 is ready for consumer payments.',
		occurredAt: d('2026-05-04T09:00:00.000Z'),
	},
	{
		id: messageIds[5],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[5],
		text: 'Frank said the base case for the model is too optimistic.',
		occurredAt: d('2026-05-04T10:00:00.000Z'),
	},
	{
		id: messageIds[6],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[6],
		text: 'Grace compared Ethereum L2 liquidity with app-specific rollups.',
		occurredAt: d('2026-05-05T09:00:00.000Z'),
	},
	{
		id: messageIds[7],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[7],
		text: 'Heidi introduced Graphite as a company building compliance workflows.',
		occurredAt: d('2026-05-05T10:00:00.000Z'),
	},
	{
		id: messageIds[8],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[0],
		text: 'Alice wants the knowledge graph to connect topics to people.',
		occurredAt: d('2026-05-05T11:00:00.000Z'),
	},
	{
		id: messageIds[9],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[0],
		text: 'Private contact detail: phone 555-0101 and alice@example.com should not become a topic.',
		occurredAt: d('2026-05-05T12:00:00.000Z'),
	},
	...Array.from({ length: 14 }, (_, index) => ({
		id: messageIds[index + 10],
		workspaceId: PRIMARY_WS,
		contactId: contactIds[index % contactIds.length],
		text: `Filler Telegram message ${index + 1} for deterministic fixture volume.`,
		occurredAt: d(`2026-05-06T${String(8 + (index % 10)).padStart(2, '0')}:00:00.000Z`),
	})),
	{
		id: '30000000-0000-4000-8000-000000000101',
		workspaceId: DECOY_WS,
		contactId: '20000000-0000-4000-8000-000000000101',
		text: 'Decoy workspace AI agents evidence must never leak.',
		occurredAt: d('2026-05-02T09:00:00.000Z'),
	},
];

const nodes: FixtureNode[] = [
	{
		id: nodeIds.aiAgents,
		workspaceId: PRIMARY_WS,
		type: 'topic',
		name: 'ai agents',
		displayName: 'AI agents',
		description: 'Autonomous software agents used for relationship workflows.',
		nameBlindIndex: hash('ai agents'),
		aliases: ['autonomous agents', 'agentic crm'],
		mentionCount: 6,
		firstSeenAt: d('2026-05-02T09:00:00.000Z'),
		lastSeenAt: d('2026-05-05T12:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.crmAutomation,
		workspaceId: PRIMARY_WS,
		type: 'project',
		name: 'crm automation',
		displayName: 'CRM automation',
		description: 'Automated follow-ups, reminders, and relationship workflows.',
		nameBlindIndex: hash('crm automation'),
		aliases: ['relationship automation', 'automated crm'],
		mentionCount: 5,
		firstSeenAt: d('2026-05-02T10:00:00.000Z'),
		lastSeenAt: d('2026-05-06T09:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.solanaDepin,
		workspaceId: PRIMARY_WS,
		type: 'sector',
		name: 'solana depin',
		displayName: 'Solana DePIN',
		description: 'Decentralized physical infrastructure projects on Solana.',
		nameBlindIndex: hash('solana depin'),
		aliases: ['depin infra', 'solana physical infrastructure'],
		mentionCount: 4,
		firstSeenAt: d('2026-05-03T11:00:00.000Z'),
		lastSeenAt: d('2026-05-03T11:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.helium,
		workspaceId: PRIMARY_WS,
		type: 'organization',
		name: 'helium',
		displayName: 'Helium',
		description: 'Wireless DePIN network and community.',
		nameBlindIndex: hash('helium'),
		aliases: ['helium network', 'hnt'],
		mentionCount: 4,
		firstSeenAt: d('2026-05-03T12:00:00.000Z'),
		lastSeenAt: d('2026-05-03T12:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.baseL2,
		workspaceId: PRIMARY_WS,
		type: 'project',
		name: 'base l2',
		displayName: 'Base L2',
		description: 'Coinbase-backed Ethereum L2 network.',
		nameBlindIndex: hash('base l2'),
		aliases: ['coinbase base', 'base chain'],
		mentionCount: 3,
		firstSeenAt: d('2026-05-04T09:00:00.000Z'),
		lastSeenAt: d('2026-05-04T09:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.ethereumL2,
		workspaceId: PRIMARY_WS,
		type: 'technology',
		name: 'ethereum l2',
		displayName: 'Ethereum L2',
		description: 'Rollup and scaling networks around Ethereum.',
		nameBlindIndex: hash('ethereum l2'),
		aliases: ['ethereum rollups', 'l2 liquidity'],
		mentionCount: 3,
		firstSeenAt: d('2026-05-05T09:00:00.000Z'),
		lastSeenAt: d('2026-05-05T09:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.graphite,
		workspaceId: PRIMARY_WS,
		type: 'organization',
		name: 'graphite',
		displayName: 'Graphite',
		description: 'Company or project mentioned in compliance workflow discussions.',
		nameBlindIndex: hash('graphite'),
		aliases: ['graphite company'],
		mentionCount: 2,
		firstSeenAt: d('2026-05-05T10:00:00.000Z'),
		lastSeenAt: d('2026-05-05T10:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.knowledgeGraph,
		workspaceId: PRIMARY_WS,
		type: 'concept',
		name: 'knowledge graph',
		displayName: 'knowledge graph',
		description: 'Concept for connecting topics, contacts, and messages.',
		nameBlindIndex: hash('knowledge graph'),
		aliases: ['topic graph', 'memory graph'],
		mentionCount: 2,
		firstSeenAt: d('2026-05-05T11:00:00.000Z'),
		lastSeenAt: d('2026-05-05T11:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.baseCase,
		workspaceId: PRIMARY_WS,
		type: 'concept',
		name: 'base case',
		displayName: 'base case',
		description: 'Generic modeling phrase that should not match Base L2 queries.',
		nameBlindIndex: hash('base case'),
		aliases: ['model base case'],
		mentionCount: 1,
		firstSeenAt: d('2026-05-04T10:00:00.000Z'),
		lastSeenAt: d('2026-05-04T10:00:00.000Z'),
		createdAt: baseDate,
	},
	{
		id: nodeIds.decoyAiAgents,
		workspaceId: DECOY_WS,
		type: 'topic',
		name: 'ai agents',
		displayName: 'AI agents',
		description: 'Decoy workspace node.',
		nameBlindIndex: hash('ai agents'),
		aliases: ['autonomous agents'],
		mentionCount: 99,
		firstSeenAt: d('2026-05-02T09:00:00.000Z'),
		lastSeenAt: d('2026-05-02T09:00:00.000Z'),
		createdAt: baseDate,
	},
];

const evidenceByNode: Record<string, Omit<FixtureEvidence, 'workspaceId' | 'createdAt'>[]> = {
	[nodeIds.aiAgents]: [
		{
			id: evidenceIds.aiAgents,
			knowledgeNodeId: nodeIds.aiAgents,
			contactId: contactIds[0],
			messageId: messageIds[0],
			relationType: 'interested_in',
			evidenceKind: 'llm_extracted',
			confidence: 0.94,
			snippet: 'Alice said AI agents could automate CRM follow-ups for warm intros.',
			occurredAt: d('2026-05-02T09:00:00.000Z'),
		},
	],
	[nodeIds.crmAutomation]: [
		{
			id: evidenceIds.crmAutomation,
			knowledgeNodeId: nodeIds.crmAutomation,
			contactId: contactIds[1],
			messageId: messageIds[1],
			relationType: 'works_on',
			evidenceKind: 'llm_extracted',
			confidence: 0.92,
			snippet: 'Bob is testing CRM automation for investor updates and reminders.',
			occurredAt: d('2026-05-02T10:00:00.000Z'),
		},
	],
	[nodeIds.solanaDepin]: [
		{
			id: evidenceIds.solanaDepin,
			knowledgeNodeId: nodeIds.solanaDepin,
			contactId: contactIds[2],
			messageId: messageIds[2],
			relationType: 'knows_about',
			evidenceKind: 'llm_extracted',
			confidence: 0.9,
			snippet: 'Carol mentioned DePIN infra on Solana for sensor networks.',
			occurredAt: d('2026-05-03T11:00:00.000Z'),
		},
	],
	[nodeIds.helium]: [
		{
			id: evidenceIds.helium,
			knowledgeNodeId: nodeIds.helium,
			contactId: contactIds[3],
			messageId: messageIds[3],
			relationType: 'member_of',
			evidenceKind: 'llm_extracted',
			confidence: 0.91,
			snippet: 'Dan is tracking Helium hotspots and community deployments.',
			occurredAt: d('2026-05-03T12:00:00.000Z'),
		},
	],
	[nodeIds.baseL2]: [
		{
			id: evidenceIds.baseL2,
			knowledgeNodeId: nodeIds.baseL2,
			contactId: contactIds[4],
			messageId: messageIds[4],
			relationType: 'interested_in',
			evidenceKind: 'llm_extracted',
			confidence: 0.89,
			snippet: 'Eve asked whether Base L2 is ready for consumer payments.',
			occurredAt: d('2026-05-04T09:00:00.000Z'),
		},
	],
	[nodeIds.ethereumL2]: [
		{
			id: evidenceIds.ethereumL2,
			knowledgeNodeId: nodeIds.ethereumL2,
			contactId: contactIds[6],
			messageId: messageIds[6],
			relationType: 'knows_about',
			evidenceKind: 'embedding_match',
			confidence: 0.8,
			snippet: 'Grace compared Ethereum L2 liquidity with app-specific rollups.',
			occurredAt: d('2026-05-05T09:00:00.000Z'),
		},
	],
	[nodeIds.graphite]: [
		{
			id: evidenceIds.graphite,
			knowledgeNodeId: nodeIds.graphite,
			contactId: contactIds[7],
			messageId: messageIds[7],
			relationType: 'works_on',
			evidenceKind: 'llm_extracted',
			confidence: 0.86,
			snippet: 'Heidi introduced Graphite as a company building compliance workflows.',
			occurredAt: d('2026-05-05T10:00:00.000Z'),
		},
	],
	[nodeIds.knowledgeGraph]: [
		{
			id: evidenceIds.knowledgeGraph,
			knowledgeNodeId: nodeIds.knowledgeGraph,
			contactId: contactIds[0],
			messageId: messageIds[8],
			relationType: 'uses',
			evidenceKind: 'llm_extracted',
			confidence: 0.88,
			snippet: 'Alice wants the knowledge graph to connect topics to people.',
			occurredAt: d('2026-05-05T11:00:00.000Z'),
		},
	],
	[nodeIds.baseCase]: [
		{
			id: evidenceIds.baseCase,
			knowledgeNodeId: nodeIds.baseCase,
			contactId: contactIds[5],
			messageId: messageIds[5],
			relationType: 'knows_about',
			evidenceKind: 'llm_extracted',
			confidence: 0.76,
			snippet: 'Frank said the base case for the model is too optimistic.',
			occurredAt: d('2026-05-04T10:00:00.000Z'),
		},
	],
	[nodeIds.decoyAiAgents]: [
		{
			id: evidenceIds.decoyAiAgents,
			knowledgeNodeId: nodeIds.decoyAiAgents,
			contactId: '20000000-0000-4000-8000-000000000101',
			messageId: '30000000-0000-4000-8000-000000000101',
			relationType: 'interested_in',
			evidenceKind: 'llm_extracted',
			confidence: 0.99,
			snippet: 'Decoy workspace AI agents evidence must never leak.',
			occurredAt: d('2026-05-02T09:00:00.000Z'),
		},
	],
};

const evidence: FixtureEvidence[] = Object.values(evidenceByNode)
	.flat()
	.map((row) => ({
		...row,
		workspaceId: nodes.find((node) => node.id === row.knowledgeNodeId)?.workspaceId ?? PRIMARY_WS,
		createdAt: row.occurredAt,
	}));

const knowledgeContacts: FixtureKnowledgeContact[] = evidence.map((row) => ({
	workspaceId: row.workspaceId,
	nodeId: row.knowledgeNodeId,
	contactId: row.contactId,
	relationType: row.relationType,
	strength: row.confidence,
	evidenceCount: 1,
	lastEvidenceAt: row.occurredAt,
}));

const memories: FixtureMemory[] = [
	{
		id: '60000000-0000-4000-8000-000000000001',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[0],
		contentSanitized: 'masked memory about autonomous sales workflows and agentic followups',
		category: 'general',
		metadata: { messageId: messageIds[0], source: 'ai_embeddings_worker' },
		createdAt: d('2026-05-02T09:01:00.000Z'),
		semanticScore: 0.84,
		ftsRank: 0.5,
		rrfScore: 0.07,
	},
	{
		id: '60000000-0000-4000-8000-000000000002',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[2],
		contentSanitized: 'legacy note about DePIN infra pilots on Solana sensors',
		category: 'general',
		metadata: { sourceMessageId: messageIds[2] },
		createdAt: d('2026-05-03T11:01:00.000Z'),
		semanticScore: 0.8,
		ftsRank: 0.6,
		rrfScore: 0.08,
	},
	{
		id: '60000000-0000-4000-8000-000000000003',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[3],
		contentSanitized: 'wireless hotspot rollout with helium community operators',
		category: 'general',
		metadata: { message_id: messageIds[3] },
		createdAt: d('2026-05-03T12:01:00.000Z'),
		semanticScore: 0.82,
		ftsRank: 0.7,
		rrfScore: 0.09,
	},
	{
		id: '60000000-0000-4000-8000-000000000004',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[4],
		contentSanitized: 'consumer payments rollout on a coinbase l2',
		category: 'general',
		metadata: { messageId: messageIds[4] },
		createdAt: d('2026-05-04T09:01:00.000Z'),
		semanticScore: 0.83,
		ftsRank: 0.4,
		rrfScore: 0.06,
	},
	{
		id: '60000000-0000-4000-8000-000000000005',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[5],
		contentSanitized: 'ambiguous base could mean Base L2 or base case',
		category: 'general',
		metadata: { sourceMessageIds: [messageIds[4], messageIds[5]] },
		createdAt: d('2026-05-04T10:01:00.000Z'),
		semanticScore: 0.9,
		ftsRank: 0.9,
		rrfScore: 0.1,
	},
	{
		id: '60000000-0000-4000-8000-000000000006',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[1],
		contentSanitized: 'keyword only crm memory',
		category: 'general',
		metadata: { keywords: ['crm'] },
		createdAt: d('2026-05-02T10:01:00.000Z'),
		semanticScore: 0.9,
		ftsRank: 0.9,
		rrfScore: 0.1,
	},
	{
		id: '60000000-0000-4000-8000-000000000007',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[1],
		contentSanitized: 'contact timestamp only note about crm',
		category: 'general',
		metadata: { contactId: contactIds[1], occurredAt: '2026-05-02T10:00:00.000Z' },
		createdAt: d('2026-05-02T10:02:00.000Z'),
		semanticScore: 0.9,
		ftsRank: 0.9,
		rrfScore: 0.1,
	},
	{
		id: '60000000-0000-4000-8000-000000000008',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[0],
		contentSanitized: 'unmatched source message memory',
		category: 'general',
		metadata: { sourceMessageId: '30000000-0000-4000-8000-000000000099' },
		createdAt: d('2026-05-02T10:03:00.000Z'),
		semanticScore: 0.9,
		ftsRank: 0.9,
		rrfScore: 0.1,
	},
	{
		id: '60000000-0000-4000-8000-000000000009',
		workspaceId: PRIMARY_WS,
		contactId: contactIds[0],
		contentSanitized: 'weak memory hit about unrelated vague topic',
		category: 'general',
		metadata: { messageId: messageIds[0] },
		createdAt: d('2026-05-02T10:04:00.000Z'),
		semanticScore: 0.2,
		ftsRank: 0,
		rrfScore: 0.01,
	},
	{
		id: '60000000-0000-4000-8000-000000000010',
		workspaceId: DECOY_WS,
		contactId: '20000000-0000-4000-8000-000000000101',
		contentSanitized: 'decoy ai agents memory',
		category: 'general',
		metadata: { messageId: '30000000-0000-4000-8000-000000000101' },
		createdAt: d('2026-05-02T09:01:00.000Z'),
		semanticScore: 0.99,
		ftsRank: 0.9,
		rrfScore: 0.1,
	},
];

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[?!.]+$/g, '')
		.trim();
}

function deterministicMessageId(memory: FixtureMemory): string | null {
	for (const key of ['messageId', 'message_id', 'sourceMessageId', 'source_message_id']) {
		const value = memory.metadata[key];
		if (typeof value === 'string') return value;
	}
	return null;
}

function messageExistsInWorkspace(workspaceId: string, messageId: string): boolean {
	return messages.some(
		(message) => message.workspaceId === workspaceId && message.id === messageId,
	);
}

function memoryMatchesQuery(memory: FixtureMemory, query: string): boolean {
	const normalizedQuery = normalize(query);
	if (!normalizedQuery) return false;
	const content = normalize(memory.contentSanitized);
	if (content.includes(normalizedQuery)) return true;
	if (normalizedQuery === 'wireless hotspot rollout') return content.includes('wireless hotspot');
	if (normalizedQuery === 'rollup migration') return content.includes('consumer payments');
	if (normalizedQuery === 'autonomous sales workflows') return content.includes('autonomous sales');
	if (normalizedQuery === 'ambiguous base') return content.includes('ambiguous base');
	if (normalizedQuery === 'keyword only crm') return content.includes('keyword only');
	if (normalizedQuery === 'contact timestamp crm') return content.includes('contact timestamp');
	if (normalizedQuery === 'weak vague topic') return content.includes('weak memory hit');
	return normalizedQuery
		.split(/\s+/)
		.filter((token) => token.length > 3)
		.every((token) => content.includes(token));
}

export const knowledgeRecallFixture = {
	workspaceId: PRIMARY_WS,
	decoyWorkspaceId: DECOY_WS,
	contacts,
	messages,
	memories,
	nodes,
	knowledgeContacts,
	evidence,
	nodeIds,
	evidenceIds,
	messageIds,
	contactIds,
	exactRows(workspaceId: string, query: string): FixtureNode[] {
		const normalizedQuery = normalize(query);
		return nodes.filter(
			(node) => node.workspaceId === workspaceId && node.name === normalizedQuery,
		);
	},
	aliasRows(workspaceId: string, query: string): FixtureNode[] {
		const normalizedQuery = normalize(query);
		return nodes.filter(
			(node) => node.workspaceId === workspaceId && node.aliases.includes(normalizedQuery),
		);
	},
	semanticRows(workspaceId: string, query: string): Array<FixtureNode & { similarity: number }> {
		const normalizedQuery = normalize(query);
		const scores = new Map<string, number>();
		if (normalizedQuery === 'autonomous sales workflows') {
			scores.set(nodeIds.crmAutomation, 0.76);
			scores.set(nodeIds.aiAgents, 0.64);
		}
		if (normalizedQuery === 'rollup migration') {
			scores.set(nodeIds.ethereumL2, 0.72);
			scores.set(nodeIds.baseL2, 0.74);
		}
		if (normalizedQuery === 'totally unrelated query') {
			scores.set(nodeIds.baseCase, 0.31);
		}
		return nodes
			.filter((node) => node.workspaceId === workspaceId && scores.has(node.id))
			.map((node) => ({ ...node, similarity: scores.get(node.id) ?? 0 }))
			.sort((a, b) => b.similarity - a.similarity);
	},
	memoryHits(workspaceId: string, query: string) {
		return memories
			.filter((memory) => memory.workspaceId === workspaceId && memoryMatchesQuery(memory, query))
			.map((memory) => {
				const messageId = deterministicMessageId(memory);
				if (!messageId || !messageExistsInWorkspace(workspaceId, messageId)) return null;
				return {
					memoryId: memory.id,
					messageId,
					content: memory.contentSanitized,
					category: memory.category,
					rrfScore: memory.rrfScore ?? 0.01,
					semanticScore: memory.semanticScore ?? 0,
					ftsRank: memory.ftsRank ?? 0,
					contactId: memory.contactId,
					memoryCreatedAt: memory.createdAt,
				};
			})
			.filter((row): row is NonNullable<typeof row> => row !== null);
	},
	recallRowsForMemoryHits(workspaceId: string, hits: Array<{ messageId: string }>) {
		const messageIds = new Set(hits.map((hit) => hit.messageId));
		return evidence
			.filter((row) => row.workspaceId === workspaceId && messageIds.has(row.messageId))
			.map((row) => {
				const node = nodes.find((item) => item.id === row.knowledgeNodeId);
				if (!node) return null;
				return {
					nodeId: node.id,
					workspaceId: node.workspaceId,
					type: node.type,
					name: node.name,
					displayName: node.displayName,
					description: node.description,
					nameBlindIndex: node.nameBlindIndex,
					aliases: node.aliases,
					mentionCount: node.mentionCount,
					firstSeenAt: node.firstSeenAt,
					lastSeenAt: node.lastSeenAt,
					createdAt: node.createdAt,
					evidenceId: row.id,
					messageId: row.messageId,
					evidenceOccurredAt: row.occurredAt,
					evidenceCreatedAt: row.createdAt,
				};
			})
			.filter((row): row is NonNullable<typeof row> => row !== null);
	},
	contactRowsForNodes(workspaceId: string, ids: string[]) {
		const nodeIdSet = new Set(ids);
		return knowledgeContacts
			.filter((row) => row.workspaceId === workspaceId && nodeIdSet.has(row.nodeId))
			.map((row) => {
				const contact = contacts.find(
					(item) => item.workspaceId === workspaceId && item.id === row.contactId,
				);
				if (!contact) return null;
				return {
					nodeId: row.nodeId,
					contactId: contact.id,
					firstName: contact.firstName,
					lastName: contact.lastName,
					relationType: row.relationType,
					strength: row.strength,
					evidenceCount: row.evidenceCount,
					lastEvidenceAt: row.lastEvidenceAt,
				};
			})
			.filter((row): row is NonNullable<typeof row> => row !== null);
	},
	evidenceRowsForNodes(workspaceId: string, ids: string[]) {
		const nodeIdSet = new Set(ids);
		return evidence
			.filter((row) => row.workspaceId === workspaceId && nodeIdSet.has(row.knowledgeNodeId))
			.map((row) => ({
				id: row.id,
				knowledgeNodeId: row.knowledgeNodeId,
				contactId: row.contactId,
				messageId: row.messageId,
				relationType: row.relationType,
				evidenceKind: row.evidenceKind,
				confidence: row.confidence,
				snippet: row.snippet,
				occurredAt: row.occurredAt,
				createdAt: row.createdAt,
			}));
	},
};

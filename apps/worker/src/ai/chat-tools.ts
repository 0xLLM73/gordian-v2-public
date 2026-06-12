import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { SealedEnvelope } from '@repo/crypto';
import { getCurrentKeys, maskEntities, withKeys } from '@repo/crypto';
import {
	getActiveCommitments,
	getCommitmentsByContact,
	getContact,
	getDashboardStats,
	getDeal,
	getDealsByContact,
	getHealthScoresByWorkspace,
	getMessageContactCoverageReport,
	getMessagesByTimeRange,
	graphragSearch,
	hybridSearch,
	knowledgeGraphSearch,
	listContacts,
	listDeals,
	listKnowledgeNodes,
	provenanceSearch,
	searchContactByName,
	searchKnowledgeNodes,
} from '@repo/db';
import { generateDraft } from './draft-generation';
import { generateEmbedding } from './embeddings';
import { findRelevantPrecedents, formatPrecedents } from './precedents';
import { prefilterEntities } from './prefilter';

// SEC-PROV-011: Format provenance results with whitelisted fields only
function formatProvenanceResults(results: Awaited<ReturnType<typeof provenanceSearch>>): string {
	if (results.length === 0) return '';
	return results
		.map((r) => {
			const parts = [
				`[${r.nodeType}] ${r.displayName} (score: ${r.provenanceScore.toFixed(2)}, depth: ${r.depth})`,
			];
			if (r.description) parts.push(`  Description: ${r.description}`);
			if (r.decisionAction) parts.push(`  Action: ${r.decisionAction}`);
			if (r.decisionDate) parts.push(`  Date: ${r.decisionDate}`);
			if (r.outcomeResult) parts.push(`  Outcome: ${r.outcomeResult}`);
			if (r.outcomeRoiWeight != null) parts.push(`  ROI Weight: ${r.outcomeRoiWeight.toFixed(2)}`);
			if (r.maskedEvidenceQuote) parts.push(`  Evidence: "${r.maskedEvidenceQuote}"`);
			return parts.join('\n');
		})
		.join('\n\n');
}

export const SEARCH_CONTACTS_TOOL: Tool = {
	name: 'search_contacts',
	description: 'Search for contacts by name. Returns matching contacts with their basic info.',
	input_schema: {
		type: 'object' as const,
		properties: {
			name: {
				type: 'string',
				description: 'The name to search for (first name match)',
			},
		},
		required: ['name'],
	},
};

export const GET_COMMITMENTS_TOOL: Tool = {
	name: 'get_commitments',
	description:
		'Get commitments (promises, tasks, meetings). Can filter by contact or get all active commitments.',
	input_schema: {
		type: 'object' as const,
		properties: {
			contact_id: {
				type: 'string',
				description: 'Optional contact ID to filter commitments for a specific person',
			},
		},
		required: [],
	},
};

export const GET_DEALS_TOOL: Tool = {
	name: 'get_deals',
	description: 'Get deals. Can filter by contact or list all deals with their stage and value.',
	input_schema: {
		type: 'object' as const,
		properties: {
			contact_id: {
				type: 'string',
				description: 'Optional contact ID to filter deals for a specific person',
			},
		},
		required: [],
	},
};

export const SEARCH_MEMORIES_TOOL: Tool = {
	name: 'search_memories',
	description:
		'Search stored memories and notes using semantic + keyword search. Use for questions about past conversations, preferences, or context.',
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string',
				description: 'The search query (e.g., "funding round", "partnership discussion")',
			},
		},
		required: ['query'],
	},
};

export const SEARCH_KNOWLEDGE_TOOL: Tool = {
	name: 'search_knowledge',
	description:
		'Search the knowledge graph for topics, projects, technologies, sectors, or concepts that contacts are knowledgeable about. Returns a root node and related nodes up to 2 hops away.',
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string',
				description:
					'The topic or entity to look up (e.g., "Ethereum L2 scaling", "DeFi protocols")',
			},
		},
		required: ['query'],
	},
};

export const SEARCH_PRECEDENTS_TOOL: Tool = {
	name: 'search_precedents',
	description:
		'Search past outcome records for similar situations. Returns anonymised precedents (type, result, category labels, date) — no names or private notes. Use to find how similar deals, commitments, or introductions played out historically.',
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string',
				description:
					'Describe the situation to find precedents for, using category terms rather than names (e.g., "deal lost small value equity", "commitment missed habit goal")',
			},
		},
		required: ['query'],
	},
};

export const GET_WORKSPACE_CONTEXT_TOOL: Tool = {
	name: 'get_workspace_context',
	description:
		'Get a safe local workspace overview for broad questions. Returns counts, top contacts, open deals, active commitments, relationship-health labels, imported-message coverage, and top generated knowledge nodes. Use first for broad questions like "what themes do you see?", "what should I know?", "what is going on?", or "summarize my local data".',
	input_schema: {
		type: 'object' as const,
		properties: {},
		required: [],
	},
};

export const LIST_KNOWLEDGE_TOPICS_TOOL: Tool = {
	name: 'list_knowledge_topics',
	description:
		'List top generated knowledge graph topics, projects, organizations, technologies, sectors, and concepts. Use for broad topic/theme questions before asking the user to provide a specific topic.',
	input_schema: {
		type: 'object' as const,
		properties: {
			limit: {
				type: 'number',
				description: 'Maximum topics to return. Defaults to 12 and is capped at 20.',
			},
			type: {
				type: 'string',
				enum: ['topic', 'project', 'organization', 'technology', 'sector', 'concept'],
				description: 'Optional knowledge node type filter.',
			},
		},
		required: [],
	},
};

export const SEARCH_IMPORTED_MESSAGES_TOOL: Tool = {
	name: 'search_imported_messages',
	description:
		'Search encrypted imported Telegram messages locally for a specific query. Returns only bounded, entity-masked snippets with timestamps and direction; raw private message text is not returned. Use only when the user asks about a specific term, topic, or conversation detail.',
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string',
				description: 'Specific term or topic to search for in local imported messages.',
			},
			days: {
				type: 'number',
				description: 'Lookback window in days. Defaults to 90 and is capped at 365.',
			},
			limit: {
				type: 'number',
				description: 'Maximum masked snippets to return. Defaults to 6 and is capped at 10.',
			},
		},
		required: ['query'],
	},
};

type KnowledgeTopicType =
	| 'topic'
	| 'project'
	| 'organization'
	| 'technology'
	| 'sector'
	| 'concept';

const KNOWLEDGE_TOPIC_TYPES = new Set<KnowledgeTopicType>([
	'topic',
	'project',
	'organization',
	'technology',
	'sector',
	'concept',
]);

export const CREATE_COMMITMENT_TOOL: Tool = {
	name: 'create_commitment',
	description:
		'Propose creating a new commitment for a contact. Returns a proposal for user confirmation — does not create anything immediately.',
	input_schema: {
		type: 'object' as const,
		properties: {
			contact_id: {
				type: 'string',
				description: 'The ID of the contact this commitment is for',
			},
			title: {
				type: 'string',
				description: 'Short description of the commitment',
			},
			commitment_type: {
				type: 'string',
				enum: ['task', 'meeting', 'promise', 'financial', 'follow_up'],
				description: 'The type of commitment',
			},
			assignee: {
				type: 'string',
				enum: ['user', 'contact'],
				description: 'Who owns the commitment — the user or the contact',
			},
			due_date: {
				type: 'string',
				description: 'Optional ISO date string for when the commitment is due (e.g. 2026-03-15)',
			},
		},
		required: ['contact_id', 'title', 'commitment_type', 'assignee'],
	},
};

export const CREATE_DEAL_TOOL: Tool = {
	name: 'create_deal',
	description:
		'Create a new deal for a contact. Use when the user wants to track a business opportunity, investment, or partnership.',
	input_schema: {
		type: 'object' as const,
		properties: {
			contact_id: {
				type: 'string',
				description: 'The UUID of the contact this deal is for',
			},
			title: {
				type: 'string',
				description: 'The deal title',
			},
			deal_type: {
				type: 'string',
				enum: ['investment', 'advisory', 'partnership', 'token', 'other'],
				description: 'The type of deal',
			},
			value: {
				type: 'number',
				description: 'Optional deal value in dollars',
			},
		},
		required: ['contact_id', 'title', 'deal_type'],
	},
};

export const CREATE_GOAL_TOOL: Tool = {
	name: 'create_goal',
	description:
		'Create a new goal. Use when the user wants to set a target to track progress toward.',
	input_schema: {
		type: 'object' as const,
		properties: {
			type: {
				type: 'string',
				enum: ['relationship', 'business', 'habit', 'network'],
				description: 'The type of goal',
			},
			title: {
				type: 'string',
				description: 'The goal title',
			},
			target_count: {
				type: 'number',
				description: 'Numeric target to track progress toward',
			},
			target_date: {
				type: 'string',
				description: 'Optional ISO date string for the goal deadline (e.g. 2026-06-01)',
			},
			contact_id: {
				type: 'string',
				description: 'Optional UUID of a contact this goal is linked to',
			},
		},
		required: ['type', 'title', 'target_count'],
	},
};

export const UPDATE_DEAL_STAGE_TOOL: Tool = {
	name: 'update_deal_stage',
	description:
		'Propose moving a deal to a new stage. Returns a proposal for user confirmation — does not update anything immediately.',
	input_schema: {
		type: 'object' as const,
		properties: {
			deal_id: {
				type: 'string',
				description: 'The ID of the deal to update',
			},
			new_stage: {
				type: 'string',
				enum: ['discovery', 'diligence', 'negotiation', 'committed', 'won', 'lost'],
				description: 'The stage to move the deal to',
			},
		},
		required: ['deal_id', 'new_stage'],
	},
};

export const DRAFT_MESSAGE_TOOL: Tool = {
	name: 'draft_message',
	description:
		'Generate a draft message for a contact based on a stated intent. Returns a proposal with the draft text for user review — does not send anything.',
	input_schema: {
		type: 'object' as const,
		properties: {
			contact_id: {
				type: 'string',
				description: 'The ID of the contact to draft a message for',
			},
			intent: {
				type: 'string',
				description: 'What the message should accomplish (e.g. "follow up on the funding round")',
			},
		},
		required: ['contact_id', 'intent'],
	},
};

export const GET_CONTACT_HEALTH_TOOL: Tool = {
	name: 'get_contact_health',
	description:
		'Get relationship health scores for contacts. Shows who is thriving, healthy, cooling, or dormant based on interaction recency, frequency, and depth. Use for questions about inactive contacts, neglected relationships, or relationship status.',
	input_schema: {
		type: 'object' as const,
		properties: {
			label: {
				type: 'string',
				enum: ['thriving', 'healthy', 'cooling', 'dormant'],
				description:
					'Optional filter by health label. Use "cooling" or "dormant" to find neglected contacts.',
			},
		},
		required: [],
	},
};

export const TRACE_DECISION_TOOL: Tool = {
	name: 'trace_decision',
	description:
		'Trace the causal history of a decision using the decision graph. Use when the user asks "why did I decide X?" or wants to understand the chain of decisions that led to an outcome.',
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string',
				description:
					'The decision or outcome to trace (e.g., "why did I pass on that deal?", "what led to the partnership commitment?")',
			},
		},
		required: ['query'],
	},
};

export const CHAT_TOOLS: Tool[] = [
	GET_WORKSPACE_CONTEXT_TOOL,
	LIST_KNOWLEDGE_TOPICS_TOOL,
	SEARCH_CONTACTS_TOOL,
	GET_COMMITMENTS_TOOL,
	GET_DEALS_TOOL,
	SEARCH_MEMORIES_TOOL,
	SEARCH_KNOWLEDGE_TOOL,
	SEARCH_IMPORTED_MESSAGES_TOOL,
	SEARCH_PRECEDENTS_TOOL,
	TRACE_DECISION_TOOL,
	CREATE_COMMITMENT_TOOL,
	CREATE_DEAL_TOOL,
	CREATE_GOAL_TOOL,
	UPDATE_DEAL_STAGE_TOOL,
	DRAFT_MESSAGE_TOOL,
	GET_CONTACT_HEALTH_TOOL,
];

// Tool result formatter — cap at 20 items
function formatToolResult(items: unknown[], label: string): string {
	if (!items || items.length === 0) return `No ${label} found.`;
	const capped = items.slice(0, 20);
	const suffix = items.length > 20 ? `\n... and ${items.length - 20} more` : '';
	return JSON.stringify(capped, null, 2) + suffix;
}

// Strip internal/noise fields that confuse the AI
function cleanForAI<T extends Record<string, unknown>>(
	rows: T[],
	omitKeys: string[],
): Record<string, unknown>[] {
	return rows.map((row) => {
		const clean: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(row)) {
			if (!omitKeys.includes(k) && v !== null && v !== undefined) {
				clean[k] = v;
			}
		}
		return clean;
	});
}

// Fields to strip from contact results (blind indexes, internal IDs)
const CONTACT_OMIT = [
	'workspaceId',
	'firstNameBidx',
	'lastNameBidx',
	'phoneBidx',
	'emailBidx',
	'sourceAccountId',
];

// Fields to strip from commitment results (vectors, internal tracing)
const COMMITMENT_OMIT = [
	'workspaceId',
	'embedding',
	'banditTraceId',
	'extractionContext',
	'confidence',
	'lastCheckedAt',
	'fulfilledAt',
	'fulfillmentEvidence',
	'snoozedUntil',
];

// Fields to strip from deal results
const DEAL_OMIT = ['workspaceId', 'stageHistory', 'terms'];

const MAX_IMPORTED_MESSAGE_SCAN = 500;

function clampPositiveNumber(value: unknown, fallback: number, max: number): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(max, Math.floor(parsed));
}

function normalizeSearchText(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function snippetAround(text: string, query: string, maxLength = 220): string {
	const normalized = text.toLowerCase();
	const index = normalized.indexOf(query.toLowerCase());
	if (index === -1) return text.slice(0, maxLength);
	const start = Math.max(0, index - 80);
	const end = Math.min(text.length, index + query.length + 120);
	const prefix = start > 0 ? '...' : '';
	const suffix = end < text.length ? '...' : '';
	return `${prefix}${text.slice(start, end)}${suffix}`.slice(0, maxLength + 6);
}

async function maskSnippet(snippet: string, envelope: SealedEnvelope): Promise<string> {
	return withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const detected = prefilterEntities(snippet);
		return maskEntities(snippet, keys.bik, detected).maskedText;
	});
}

export type ToolExecutor = (
	input: Record<string, unknown>,
	workspaceId: string,
	envelope: SealedEnvelope,
) => Promise<string>;

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
	get_workspace_context: async (_input, workspaceId, envelope) => {
		const [stats, contacts, deals, commitments, healthScores, messageCoverage, knowledgeNodes] =
			await Promise.all([
				getDashboardStats(workspaceId),
				listContacts(workspaceId, envelope, { limit: 12 }),
				listDeals(workspaceId, envelope, { limit: 12 }),
				getActiveCommitments(workspaceId, envelope, { limit: 12 }),
				getHealthScoresByWorkspace(workspaceId, { limit: 12, sort: 'composite_asc' }),
				getMessageContactCoverageReport(workspaceId),
				listKnowledgeNodes(workspaceId, { limit: 12 }, envelope),
			]);

		const contactNameById = new Map(
			contacts.map((contact) => [
				contact.id,
				[String(contact.firstName ?? ''), String(contact.lastName ?? '')].join(' ').trim() ||
					String(contact.username ?? 'Unnamed contact'),
			]),
		);

		const context = {
			counts: {
				contacts: stats.contactCount,
				activeCommitments: stats.activeCommitmentCount,
				openDeals: stats.openDealCount,
				activeGoals: stats.activeGoalCount,
				importedMessages: messageCoverage.totalMessages,
				linkedImportedMessages: messageCoverage.linkedContactMessages,
				generatedKnowledgeNodes: knowledgeNodes.length,
			},
			topContacts: contacts.slice(0, 8).map((contact) => ({
				name:
					[String(contact.firstName ?? ''), String(contact.lastName ?? '')].join(' ').trim() ||
					contact.username ||
					'Unnamed contact',
				messageCount: contact.messageCount ?? 0,
				lastMessageAt: contact.lastMessageAt ?? null,
			})),
			openDeals: cleanForAI(deals.slice(0, 8) as Record<string, unknown>[], [
				...DEAL_OMIT,
				'id',
				'contactId',
			]),
			activeCommitments: cleanForAI(commitments.slice(0, 8) as Record<string, unknown>[], [
				...COMMITMENT_OMIT,
				'id',
				'contactId',
			]),
			relationshipHealth: healthScores.slice(0, 8).map((score) => ({
				contactName: contactNameById.get(score.contactId) ?? 'Contact',
				label: score.label,
				trend: score.trend,
				composite: score.composite,
			})),
			messageCoverage: {
				totalMessages: messageCoverage.totalMessages,
				linkedContactMessages: messageCoverage.linkedContactMessages,
				messagesWithSenderMetadata: messageCoverage.messagesWithSenderMetadata,
				chatsWithUnattributedMessages: messageCoverage.chatsWithNullContactMessages,
				byChatType: messageCoverage.byChatType.map((row) => ({
					type: row.chatType,
					totalMessages: row.totalMessages,
					linkedContactMessages: row.linkedContactMessages,
				})),
			},
			topKnowledgeTopics: knowledgeNodes.slice(0, 12).map((node) => ({
				name: node.displayName,
				type: node.type,
				description: node.description ?? null,
				mentionCount: node.mentionCount,
				lastSeenAt: node.lastSeenAt ?? null,
				reviewStatus: node.reviewStatus ?? null,
			})),
			safety:
				'Workspace context is local, workspace-scoped, and read-only. Imported message content is summarized by counts here; use search_imported_messages for specific masked snippets.',
		};
		return JSON.stringify(context, null, 2);
	},

	list_knowledge_topics: async (input, workspaceId, envelope) => {
		const limit = clampPositiveNumber(input.limit, 12, 20);
		const type =
			typeof input.type === 'string' && KNOWLEDGE_TOPIC_TYPES.has(input.type as KnowledgeTopicType)
				? (input.type as KnowledgeTopicType)
				: undefined;
		const nodes = await listKnowledgeNodes(workspaceId, { limit, type }, envelope);
		if (nodes.length === 0) return 'No generated knowledge topics found.';
		return formatToolResult(
			nodes.map((node) => ({
				name: node.displayName,
				type: node.type,
				description: node.description ?? null,
				mentionCount: node.mentionCount,
				lastSeenAt: node.lastSeenAt ?? null,
				reviewStatus: node.reviewStatus ?? null,
			})),
			'knowledge topics',
		);
	},

	search_contacts: async (input, workspaceId, envelope) => {
		const name = input.name as string;
		const results = await searchContactByName(workspaceId, name, envelope);
		return formatToolResult(
			cleanForAI(results as Record<string, unknown>[], CONTACT_OMIT),
			'contacts',
		);
	},

	get_commitments: async (input, workspaceId, envelope) => {
		const contactId = input.contact_id as string | undefined;
		if (contactId) {
			const results = await getCommitmentsByContact(workspaceId, contactId, envelope, {
				limit: 20,
			});
			return formatToolResult(
				cleanForAI(results as Record<string, unknown>[], COMMITMENT_OMIT),
				'commitments',
			);
		}
		const results = await getActiveCommitments(workspaceId, envelope, { limit: 20 });
		return formatToolResult(
			cleanForAI(results as Record<string, unknown>[], COMMITMENT_OMIT),
			'commitments',
		);
	},

	get_deals: async (input, workspaceId, envelope) => {
		const contactId = input.contact_id as string | undefined;
		if (contactId) {
			const results = await getDealsByContact(workspaceId, contactId, envelope);
			return formatToolResult(cleanForAI(results as Record<string, unknown>[], DEAL_OMIT), 'deals');
		}
		const results = await listDeals(workspaceId, envelope, { limit: 20 });
		return formatToolResult(cleanForAI(results as Record<string, unknown>[], DEAL_OMIT), 'deals');
	},

	search_knowledge: async (input, workspaceId, envelope) => {
		const query = input.query as string;

		// SEC-102: Mask PII before embedding
		const maskedQuery = await withKeys(envelope, async () => {
			const keys = getCurrentKeys();
			const detected = prefilterEntities(query);
			return maskEntities(query, keys.bik, detected).maskedText;
		});
		const queryEmbedding = await generateEmbedding(maskedQuery);

		// Try provenance-aware search first
		const provenanceResults = await provenanceSearch(workspaceId, queryEmbedding, {
			maxHops: 3,
			limit: 10,
			envelope,
		});

		if (provenanceResults.length > 0) {
			const formatted = formatProvenanceResults(provenanceResults);

			// CGC: Also query decision graph when query contains decision keywords
			const decisionKeywords = ['why', 'decided', 'chose', 'reason', 'decision', 'rationale'];
			const lower = query.toLowerCase();
			if (decisionKeywords.some((k) => lower.includes(k))) {
				try {
					const graphResults = await graphragSearch(workspaceId, queryEmbedding, {
						maxDepth: 3,
						limit: 5,
					});
					if (graphResults.length > 0) {
						const decisionSection = graphResults
							.map(
								(r) =>
									`- Decision ${r.id.slice(0, 8)}... (depth: ${r.depth}, distance: ${r.semantic_distance.toFixed(3)})`,
							)
							.join('\n');
						return `Provenance search results for "${query}":\n\n${formatted}\n\nRelated Decisions (GraphRAG):\n${decisionSection}`;
					}
				} catch {
					// Non-fatal — return provenance only
				}
			}

			return `Provenance search results for "${query}":\n\n${formatted}`;
		}

		// Fallback to text search + graph traversal
		const matches = await searchKnowledgeNodes(workspaceId, query, undefined, envelope);
		if (!matches.length) {
			return `No knowledge nodes found for "${query}".`;
		}
		const root = matches[0];
		if (!root) {
			return `No knowledge nodes found for "${query}".`;
		}
		const neighbors = await knowledgeGraphSearch(root.id, workspaceId, 2, envelope);
		const result = {
			root: {
				id: root.id,
				name: root.displayName,
				type: root.type,
				description: root.description ?? null,
				mentionCount: root.mentionCount,
			},
			related: neighbors.map((n) => ({
				id: n.node.id,
				name: n.node.displayName,
				type: n.node.type,
				description: n.node.description ?? null,
				hops: n.depth,
			})),
		};
		return formatToolResult([result], 'knowledge nodes');
	},

	search_memories: async (input, workspaceId, envelope) => {
		const query = input.query as string;
		// SEC-102: Mask PII in search queries before sending to embedding API.
		// Embeddings are invertible (Vec2Text recovers 92% of text).
		const maskedQuery = await withKeys(envelope, async () => {
			const keys = getCurrentKeys();
			const detected = prefilterEntities(query);
			return maskEntities(query, keys.bik, detected).maskedText;
		});
		const queryEmbedding = await generateEmbedding(maskedQuery);
		// Raw query kept for keyword search (stays in DB, no external API)
		const results = await hybridSearch(workspaceId, queryEmbedding, query, { limit: 10 });
		// Strip internal scoring metrics — AI only needs content and category
		const cleaned = results.map((r) => ({ content: r.content, category: r.category }));
		return formatToolResult(cleaned, 'memories');
	},

	search_imported_messages: async (input, workspaceId, envelope) => {
		const query = normalizeSearchText(input.query);
		if (query.length < 2) {
			return 'Search imported messages requires a specific query of at least 2 characters.';
		}
		const days = clampPositiveNumber(input.days, 90, 365);
		const limit = clampPositiveNumber(input.limit, 6, 10);
		const end = new Date();
		const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
		const rows = await getMessagesByTimeRange(workspaceId, start, end, envelope, {
			limit: MAX_IMPORTED_MESSAGE_SCAN,
			order: 'desc',
		});

		const matches = rows
			.filter(
				(message) => typeof message.text === 'string' && message.text.toLowerCase().includes(query),
			)
			.slice(0, limit);
		if (matches.length === 0) {
			return `No imported message matches found for "${input.query}" in the last ${days} days.`;
		}

		const masked = await Promise.all(
			matches.map(async (message) => ({
				sentAt: message.sentAt,
				direction: message.isOutgoing ? 'outgoing' : 'incoming',
				maskedSnippet: await maskSnippet(
					snippetAround(String(message.text ?? ''), query),
					envelope,
				),
			})),
		);
		return formatToolResult(masked, 'imported message matches');
	},

	search_precedents: async (input, workspaceId, envelope) => {
		const query = input.query as string;

		// 1. Existing precedent search (non-PII context_labels)
		const precedents = await findRelevantPrecedents(workspaceId, query, envelope);
		const precedentSection =
			precedents.length > 0
				? `Past Outcomes:\n${formatPrecedents(precedents)}`
				: 'No similar past outcomes found.';

		// 2. Provenance graph search for related rationales + decisions
		let provenanceSection = '';
		try {
			const maskedQuery = await withKeys(envelope, async () => {
				const keys = getCurrentKeys();
				const detected = prefilterEntities(query);
				return maskEntities(query, keys.bik, detected).maskedText;
			});
			const queryEmbedding = await generateEmbedding(maskedQuery);
			const graphResults = await provenanceSearch(workspaceId, queryEmbedding, {
				maxHops: 3,
				limit: 5,
				anchorTypes: ['rationale', 'decision'],
				envelope,
			});

			if (graphResults.length > 0) {
				provenanceSection = `\n\nRelated Decision Context:\n${formatProvenanceResults(graphResults)}`;
			}
		} catch {
			// Non-fatal — return precedents only
		}

		return `${precedentSection}${provenanceSection}`;
	},

	trace_decision: async (input, workspaceId, envelope) => {
		const query = input.query as string;

		// 1. ELM-mask query before embedding (SEC-122)
		const maskedQuery = await withKeys(envelope, async () => {
			const keys = getCurrentKeys();
			const detected = prefilterEntities(query);
			return maskEntities(query, keys.bik, detected).maskedText;
		});
		const queryEmbedding = await generateEmbedding(maskedQuery);

		// 2. GraphRAG search — 3-hop causal graph traversal
		const graphResults = await graphragSearch(workspaceId, queryEmbedding, {
			maxDepth: 3,
			limit: 10,
		});

		if (graphResults.length === 0) {
			return `No decision history found for "${query}".`;
		}

		// 3. Fetch full decision records with decryption (SEC-CG-002, SEC-CG-005)
		const { db, userDecisions, inArray, and, eq } = await import('@repo/db');
		const decisionIds = graphResults.map((r) => r.id);
		const decisions = await withKeys(envelope, async () =>
			db
				.select()
				.from(userDecisions)
				.where(
					and(inArray(userDecisions.id, decisionIds), eq(userDecisions.workspaceId, workspaceId)),
				),
		);

		// 4. Build depth map from graph results
		const depthMap = new Map(graphResults.map((r) => [r.id, r.depth]));

		// 5. Format as causal chain sorted by depth
		const sorted = decisions
			.map((d) => ({ ...d, depth: depthMap.get(d.id) ?? 99 }))
			.sort((a, b) => a.depth - b.depth);

		const chain = sorted
			.map((d) => {
				const parts = [
					`[Depth ${d.depth}] ${d.decisionType}: ${d.rawContent}`,
					`  Date: ${d.createdAt.toISOString().split('T')[0]}`,
				];
				if (d.entityId) parts.push(`  Entity: ${d.entityId.slice(0, 8)}...`);
				return parts.join('\n');
			})
			.join('\n\n');

		return `Decision Trace for "${query}":\n\n${chain}`;
	},

	create_commitment: async (input, workspaceId, envelope) => {
		const contactId = input.contact_id as string;
		const contact = await getContact(workspaceId, contactId, envelope);
		if (!contact) {
			return `Contact not found with ID: ${contactId}`;
		}
		const proposal = {
			type: 'proposal',
			action: 'create_commitment',
			data: {
				contactId,
				contactName: contact.firstName,
				title: input.title as string,
				commitmentType: input.commitment_type as string,
				assignee: input.assignee as string,
				dueDate: (input.due_date as string | undefined) ?? null,
			},
		};
		return JSON.stringify(proposal);
	},

	create_deal: async (input, workspaceId, envelope) => {
		const contactId = input.contact_id as string;
		const contact = await getContact(workspaceId, contactId, envelope);
		if (!contact) {
			return `Contact not found with ID: ${contactId}`;
		}
		const proposal = {
			type: 'proposal',
			action: 'create_deal',
			data: {
				contactId,
				contactName: contact.firstName,
				title: input.title as string,
				dealType: input.deal_type as string,
				value: (input.value as number | undefined) ?? null,
			},
		};
		return JSON.stringify(proposal);
	},

	create_goal: async (input, workspaceId, envelope) => {
		const contactId = input.contact_id as string | undefined;
		let contactName: string | null = null;
		if (contactId) {
			const contact = await getContact(workspaceId, contactId, envelope);
			if (!contact) {
				return `Contact not found with ID: ${contactId}`;
			}
			contactName = contact.firstName;
		}
		const proposal = {
			type: 'proposal',
			action: 'create_goal',
			data: {
				type: input.type as string,
				title: input.title as string,
				targetCount: input.target_count as number,
				contactId: contactId ?? null,
				contactName,
				targetDate: (input.target_date as string | undefined) ?? null,
			},
		};
		return JSON.stringify(proposal);
	},

	update_deal_stage: async (input, workspaceId, envelope) => {
		const dealId = input.deal_id as string;
		const deal = await getDeal(workspaceId, dealId, envelope);
		if (!deal) {
			return `Deal not found with ID: ${dealId}`;
		}
		const proposal = {
			type: 'proposal',
			action: 'update_deal_stage',
			data: {
				dealId,
				dealTitle: deal.title,
				currentStage: deal.stage,
				newStage: input.new_stage as string,
			},
		};
		return JSON.stringify(proposal);
	},

	draft_message: async (input, workspaceId, envelope) => {
		const contactId = input.contact_id as string;
		const contact = await getContact(workspaceId, contactId, envelope);
		if (!contact) {
			return `Contact not found with ID: ${contactId}`;
		}
		const intent = input.intent as string;
		const draftText = await generateDraft(intent, '', 'casual_nudge');
		const proposal = {
			type: 'proposal',
			action: 'draft_message',
			data: {
				contactId,
				contactName: contact.firstName,
				draftText,
			},
		};
		return JSON.stringify(proposal);
	},

	get_contact_health: async (input, workspaceId, envelope) => {
		const label = input.label as string | undefined;
		const { getHealthScoresByWorkspace, getContactsByIds } = await import('@repo/db');
		const scores = await getHealthScoresByWorkspace(workspaceId, {
			label,
			limit: 20,
		});
		if (scores.length === 0)
			return 'No health scores found. Health scores are computed periodically — they may not be available yet.';
		// Resolve contact names
		const contactIds = scores.map((s) => s.contactId);
		const contactRows = await getContactsByIds(workspaceId, contactIds, envelope);
		const nameMap = new Map<string, string>();
		for (const c of contactRows) {
			const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
			if (name) nameMap.set(c.id, name);
		}
		const cleaned = scores.map((s) => ({
			contactName: nameMap.get(s.contactId) ?? 'Unknown',
			label: s.label,
			trend: s.trend,
			composite: `${Math.round(Number(s.composite) * 100)}%`,
			recency: `${Math.round(Number(s.recency) * 100)}%`,
			frequency: `${Math.round(Number(s.frequency) * 100)}%`,
			computedAt: s.computedAt,
		}));
		return formatToolResult(cleaned, 'contact health scores');
	},
};

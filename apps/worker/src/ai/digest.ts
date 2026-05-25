import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { maskEntities } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import {
	getActiveCommitments,
	getChatsByIds,
	getContactsByIds,
	getMessageTimeRangeStats,
	getMessagesByTimeRange,
	listDeals,
} from '@repo/db';
import { type DigestLlmRuntime, getDigestLlmRuntime } from '@repo/shared';
import { selectPromptVariant } from './bandit';
import { inferWithCache } from './cached-inference';
import { prefilterEntities } from './prefilter';

const DIGEST_SYSTEM_KERNEL = `You are a relationship intelligence analyst for a Telegram-based CRM.
Generate a structured daily digest summarizing activity over a time period.

Required sections:
1. ACTIVITY OVERVIEW: Message counts, new contacts, total conversations active
2. HIGHLIGHTS: Most important conversations or events (max 5)
3. KEY CONVERSATIONS: Per-contact summaries of notable exchanges (max 10)
4. ACTION ITEMS: Pending commitments, overdue items, follow-ups needed
5. WATCH LIST: Contacts with declining engagement or at-risk relationships

Rules:
- Use the contact names exactly as provided for contact_ref fields
- Message content may contain masked entities — do not try to unmask them
- If a section has no data, include it with "No activity" note
- Keep each highlight under 2 sentences
- Prioritize actionable information over narrative
- Total digest should be 500-1000 words
- Never fabricate activity — only reference provided data`;

const DIGEST_TOOL: Tool = {
	name: 'generate_digest',
	description: 'Generate a structured digest with sections',
	input_schema: {
		type: 'object' as const,
		properties: {
			activity_overview: {
				type: 'object',
				properties: {
					summary: { type: 'string' },
					message_count: { type: 'number' },
					active_conversations: { type: 'number' },
					new_contacts: { type: 'number' },
				},
				required: ['summary', 'message_count', 'active_conversations'],
			},
			highlights: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string' },
						detail: { type: 'string' },
						contact_ref: { type: 'string' },
					},
					required: ['title', 'detail'],
				},
			},
			key_conversations: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						contact_ref: { type: 'string' },
						summary: { type: 'string' },
						sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
					},
					required: ['contact_ref', 'summary'],
				},
			},
			action_items: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						item: { type: 'string' },
						priority: { type: 'string', enum: ['high', 'medium', 'low'] },
						contact_ref: { type: 'string' },
					},
					required: ['item', 'priority'],
				},
			},
			watch_list: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						contact_ref: { type: 'string' },
						reason: { type: 'string' },
					},
					required: ['contact_ref', 'reason'],
				},
			},
		},
		required: [
			'activity_overview',
			'highlights',
			'key_conversations',
			'action_items',
			'watch_list',
		],
	},
};

const STYLE_VARIANTS = ['digest_comprehensive', 'digest_concise'];
const TONE_VARIANTS = ['digest_tone_formal', 'digest_tone_casual'];

const STYLE_MODIFIERS: Record<string, string> = {
	digest_comprehensive:
		'\n\nBe COMPREHENSIVE: include all notable activity, provide context for each item, explain why things matter.',
	digest_concise:
		'\n\nBe CONCISE: bullet points only, max 5 words per item, skip context unless critical.',
};

const TONE_MODIFIERS: Record<string, string> = {
	digest_tone_formal:
		'\n\nUse formal, professional language. Structure like an executive briefing.',
	digest_tone_casual: '\n\nUse casual, direct language. Be conversational and get to the point.',
};

const LOCAL_DIGEST_JSON_KERNEL = `Return JSON only. Do not include markdown.
The JSON object must match this shape:
{
  "activity_overview": {
    "summary": "short overview",
    "message_count": 0,
    "active_conversations": 0,
    "new_contacts": 0
  },
  "highlights": [{"title": "short title", "detail": "short detail", "contact_ref": "optional name"}],
  "key_conversations": [{"contact_ref": "contact name", "summary": "short summary", "sentiment": "positive|neutral|negative"}],
  "action_items": [{"item": "action", "priority": "high|medium|low", "contact_ref": "optional name"}],
  "watch_list": [{"contact_ref": "contact name", "reason": "why to watch"}]
}

Never fabricate activity. Use empty arrays when the source data does not support a section.`;

const LOCAL_DIGEST_BATCH_JSON_KERNEL = `Return JSON only. Do not include markdown.
Summarize only the evidence in this batch. Do not write the final digest.
The JSON object must match this shape:
{
  "summary": "compact summary of this batch",
  "highlights": ["short notable point"],
  "key_conversations": [{"contact_ref": "contact or conversation name", "summary": "what happened"}],
  "action_items": [{"item": "action", "priority": "high|medium|low", "contact_ref": "optional name"}],
  "watch_list": [{"contact_ref": "contact or conversation name", "reason": "why to watch"}]
}

Never fabricate activity. Use empty arrays when the source data does not support a section.`;

const LOCAL_DIGEST_JSON_REPAIR_KERNEL = `You repair malformed JSON from a local digest model.
Return valid JSON only. Do not include markdown or commentary.
Preserve the original meaning when possible. If a partially malformed array or item cannot be repaired, omit only that item.`;

function positiveIntegerEnv(name: string, fallback: number, max: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(parsed, max);
}

function booleanEnv(name: string, fallback: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
	if (['0', 'false', 'no', 'off'].includes(raw)) return false;
	return fallback;
}

const LOCAL_DIGEST_MAX_TOKENS = positiveIntegerEnv('LOCAL_DIGEST_MAX_TOKENS', 1536, 8192);
const LOCAL_DIGEST_BATCH_MAX_TOKENS = positiveIntegerEnv(
	'LOCAL_DIGEST_BATCH_MAX_TOKENS',
	768,
	4096,
);
const DIGEST_CONTEXT_MESSAGE_BUDGET = positiveIntegerEnv(
	'DIGEST_CONTEXT_MESSAGE_BUDGET',
	240,
	5000,
);
const DIGEST_CONTEXT_PAGE_SIZE = positiveIntegerEnv('DIGEST_CONTEXT_PAGE_SIZE', 20, 250);
const DIGEST_CONTEXT_MAX_CONTACTS = positiveIntegerEnv('DIGEST_CONTEXT_MAX_CONTACTS', 12, 100);
const DIGEST_CONTEXT_MESSAGES_PER_CONTACT = positiveIntegerEnv(
	'DIGEST_CONTEXT_MESSAGES_PER_CONTACT',
	6,
	50,
);
const DIGEST_BATCHING_ENABLED = booleanEnv('DIGEST_BATCHING_ENABLED', true);
const DIGEST_BATCH_MESSAGE_COUNT = positiveIntegerEnv('DIGEST_BATCH_MESSAGE_COUNT', 60, 500);
const DIGEST_BATCH_MAX_BATCHES = positiveIntegerEnv('DIGEST_BATCH_MAX_BATCHES', 12, 50);

export interface DigestInput {
	userId: string;
	workspaceId: string;
	periodStart: Date;
	periodEnd: Date;
	digestFocus: 'balanced' | 'commitments' | 'relationships' | 'deals' | 'network';
	workspaceSalt: Buffer;
}

export interface DigestResult {
	content: string;
	sections: unknown;
	model: string;
	messageCount: number;
	contactCount: number;
	styleTraceId: string;
	toneTraceId: string;
	styleVariant: string;
	toneVariant: string;
}

type DigestSentiment = 'positive' | 'neutral' | 'negative';
type DigestPriority = 'high' | 'medium' | 'low';

interface DigestSections {
	activity_overview: {
		summary: string;
		message_count: number;
		active_conversations: number;
		new_contacts?: number;
	};
	source_coverage?: DigestSourceCoverage;
	highlights: Array<{ title: string; detail: string; contact_ref?: string }>;
	key_conversations: Array<{
		contact_ref: string;
		summary: string;
		sentiment?: DigestSentiment;
	}>;
	action_items: Array<{ item: string; priority: DigestPriority; contact_ref?: string }>;
	watch_list: Array<{ contact_ref: string; reason: string }>;
}

interface DigestSourceCoverage {
	total_messages: number;
	sampled_messages: number;
	total_conversations: number;
	sampled_conversations: number;
	prompt_conversations: number;
	prompt_messages: number;
	sample_strategy: string;
	message_budget: number;
	batch_count?: number;
	batch_messages?: number;
	batch_strategy?: string;
}

type DigestMessageRow = Awaited<ReturnType<typeof getMessagesByTimeRange>>[number];
type DigestPromptMessage = {
	chatId: string;
	contactId: string;
	conversationId: string;
	content: string;
	sentAt: string;
	senderName: string;
};

interface DigestPromptConversation {
	displayName: string;
	msgs: DigestPromptMessage[];
	representativeMessages: DigestPromptMessage[];
}

interface DigestBatchSummary {
	batchIndex: number;
	conversationCount: number;
	messageCount: number;
	summary: string;
	highlights: string[];
	keyConversations: Array<{ contact_ref: string; summary: string }>;
	actionItems: Array<{ item: string; priority: DigestPriority; contact_ref?: string }>;
	watchList: Array<{ contact_ref: string; reason: string }>;
}

function digestResponseFormat(): Record<string, unknown> {
	return DIGEST_TOOL.input_schema;
}

function digestBatchResponseFormat(): Record<string, unknown> {
	return {
		type: 'object',
		properties: {
			summary: { type: 'string' },
			highlights: { type: 'array', items: { type: 'string' } },
			key_conversations: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						contact_ref: { type: 'string' },
						summary: { type: 'string' },
					},
					required: ['contact_ref', 'summary'],
				},
			},
			action_items: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						item: { type: 'string' },
						priority: { type: 'string', enum: ['high', 'medium', 'low'] },
						contact_ref: { type: 'string' },
					},
					required: ['item', 'priority'],
				},
			},
			watch_list: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						contact_ref: { type: 'string' },
						reason: { type: 'string' },
					},
					required: ['contact_ref', 'reason'],
				},
			},
		},
		required: ['summary', 'highlights', 'key_conversations', 'action_items', 'watch_list'],
	};
}

function stripJsonFence(text: string): string {
	return text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

function parseJsonObject(text: string): Record<string, unknown> {
	const stripped = stripJsonFence(text);
	const firstBrace = stripped.indexOf('{');
	const lastBrace = stripped.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
		throw new Error('Local digest returned non-JSON content');
	}
	return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function sentimentValue(value: unknown): DigestSentiment | undefined {
	return value === 'positive' || value === 'neutral' || value === 'negative' ? value : undefined;
}

function priorityValue(value: unknown): DigestPriority {
	return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function normalizeDigestSections(
	raw: Record<string, unknown>,
	messageCount: number,
	contactCount: number,
	sourceCoverage: DigestSourceCoverage,
): DigestSections {
	const activity = objectValue(raw.activity_overview);
	return {
		activity_overview: {
			summary:
				stringValue(activity.summary) ??
				(messageCount > 0
					? `Reviewed ${messageCount} messages across ${contactCount} conversations.`
					: 'No message activity in this period.'),
			message_count: numberValue(activity.message_count, messageCount),
			active_conversations: numberValue(activity.active_conversations, contactCount),
			new_contacts: numberValue(activity.new_contacts, 0),
		},
		source_coverage: sourceCoverage,
		highlights: arrayValue(raw.highlights)
			.map(objectValue)
			.map((item) => ({
				title: stringValue(item.title) ?? 'Activity highlight',
				detail: stringValue(item.detail) ?? '',
				contact_ref: stringValue(item.contact_ref),
			}))
			.filter((item) => item.detail),
		key_conversations: arrayValue(raw.key_conversations)
			.map(objectValue)
			.map((item) => ({
				contact_ref: stringValue(item.contact_ref) ?? 'Unknown Contact',
				summary: stringValue(item.summary) ?? '',
				sentiment: sentimentValue(item.sentiment),
			}))
			.filter((item) => item.summary),
		action_items: arrayValue(raw.action_items)
			.map(objectValue)
			.map((item) => ({
				item: stringValue(item.item) ?? '',
				priority: priorityValue(item.priority),
				contact_ref: stringValue(item.contact_ref),
			}))
			.filter((item) => item.item),
		watch_list: arrayValue(raw.watch_list)
			.map(objectValue)
			.map((item) => ({
				contact_ref: stringValue(item.contact_ref) ?? 'Unknown Contact',
				reason: stringValue(item.reason) ?? '',
			}))
			.filter((item) => item.reason),
	};
}

function normalizeDigestBatchSummary(
	raw: Record<string, unknown>,
	batchIndex: number,
	messageCount: number,
	conversationCount: number,
): DigestBatchSummary {
	return {
		batchIndex,
		conversationCount,
		messageCount,
		summary: stringValue(raw.summary) ?? 'No notable activity in this batch.',
		highlights: arrayValue(raw.highlights)
			.map(stringValue)
			.filter((item): item is string => Boolean(item))
			.slice(0, 5),
		keyConversations: arrayValue(raw.key_conversations)
			.map(objectValue)
			.map((item) => ({
				contact_ref: stringValue(item.contact_ref) ?? 'Unknown Contact',
				summary: stringValue(item.summary) ?? '',
			}))
			.filter((item) => item.summary)
			.slice(0, 8),
		actionItems: arrayValue(raw.action_items)
			.map(objectValue)
			.map((item) => ({
				item: stringValue(item.item) ?? '',
				priority: priorityValue(item.priority),
				contact_ref: stringValue(item.contact_ref),
			}))
			.filter((item) => item.item)
			.slice(0, 8),
		watchList: arrayValue(raw.watch_list)
			.map(objectValue)
			.map((item) => ({
				contact_ref: stringValue(item.contact_ref) ?? 'Unknown Contact',
				reason: stringValue(item.reason) ?? '',
			}))
			.filter((item) => item.reason)
			.slice(0, 8),
	};
}

function uniqueMessages(messages: DigestMessageRow[]): DigestMessageRow[] {
	const seen = new Set<string>();
	const unique: DigestMessageRow[] = [];
	for (const message of messages) {
		const key = message.id;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(message);
	}
	return unique;
}

function timeSpreadOffsets(totalMessages: number, budget: number, pageSize: number): number[] {
	if (totalMessages <= budget) return [0];
	const pageCount = Math.ceil(budget / pageSize);
	if (pageCount <= 1) return [0];

	const maxOffset = Math.max(0, totalMessages - pageSize);
	return Array.from({ length: pageCount }, (_, index) =>
		Math.round((maxOffset * index) / (pageCount - 1)),
	);
}

async function getDigestContextMessages(
	workspaceId: string,
	periodStart: Date,
	periodEnd: Date,
	envelope: SealedEnvelope,
): Promise<{
	rows: DigestMessageRow[];
	totalMessageCount: number;
	totalContactCount: number;
	sampleStrategy: string;
}> {
	const stats = await getMessageTimeRangeStats(workspaceId, periodStart, periodEnd);
	if (stats.messageCount === 0) {
		return {
			rows: [],
			totalContactCount: 0,
			totalMessageCount: 0,
			sampleStrategy: 'empty-period',
		};
	}

	if (stats.messageCount <= DIGEST_CONTEXT_MESSAGE_BUDGET) {
		const rows = await getMessagesByTimeRange(workspaceId, periodStart, periodEnd, envelope, {
			limit: stats.messageCount,
			order: 'asc',
		});
		return {
			rows,
			totalContactCount: stats.contactCount,
			totalMessageCount: stats.messageCount,
			sampleStrategy: 'full-period',
		};
	}

	const pageSize = Math.min(DIGEST_CONTEXT_PAGE_SIZE, DIGEST_CONTEXT_MESSAGE_BUDGET);
	const offsets = timeSpreadOffsets(stats.messageCount, DIGEST_CONTEXT_MESSAGE_BUDGET, pageSize);
	const pages = await Promise.all(
		offsets.map((offset) =>
			getMessagesByTimeRange(workspaceId, periodStart, periodEnd, envelope, {
				limit: pageSize,
				offset,
				order: 'desc',
			}),
		),
	);
	const rows = uniqueMessages(pages.flat())
		.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
		.slice(0, DIGEST_CONTEXT_MESSAGE_BUDGET);

	return {
		rows,
		totalContactCount: stats.contactCount,
		totalMessageCount: stats.messageCount,
		sampleStrategy: `time-spread:${offsets.length}x${pageSize}`,
	};
}

function selectRepresentativeMessages<T extends { sentAt: string }>(
	messages: T[],
	maxMessages: number,
): T[] {
	if (messages.length <= maxMessages) return messages;
	if (maxMessages <= 1) return [messages[messages.length - 1]].filter(Boolean);

	const indexes = new Set<number>();
	for (let index = 0; index < maxMessages; index += 1) {
		indexes.add(Math.round(((messages.length - 1) * index) / (maxMessages - 1)));
	}

	return [...indexes]
		.sort((a, b) => a - b)
		.map((index) => messages[index])
		.filter((message): message is T => Boolean(message));
}

async function callLocalDigestModel(
	systemKernel: string,
	userPrompt: string,
): Promise<{ model: string; sections: Record<string, unknown> }> {
	const local = await callLocalJsonModel(
		`${systemKernel}\n\n${LOCAL_DIGEST_JSON_KERNEL}`,
		userPrompt,
		{
			format: digestResponseFormat(),
			maxTokens: LOCAL_DIGEST_MAX_TOKENS,
		},
	);
	const nestedSections = objectValue(local.parsed.sections);
	return {
		model: local.model,
		sections: Object.keys(nestedSections).length > 0 ? nestedSections : local.parsed,
	};
}

async function callLocalDigestBatchModel(
	systemKernel: string,
	userPrompt: string,
): Promise<{ model: string; summary: Record<string, unknown> }> {
	const local = await callLocalJsonModel(
		`${systemKernel}\n\n${LOCAL_DIGEST_BATCH_JSON_KERNEL}`,
		userPrompt,
		{
			format: digestBatchResponseFormat(),
			maxTokens: LOCAL_DIGEST_BATCH_MAX_TOKENS,
		},
	);
	const nestedSummary = objectValue(local.parsed.summary_batch);
	return {
		model: local.model,
		summary: Object.keys(nestedSummary).length > 0 ? nestedSummary : local.parsed,
	};
}

async function callLocalJsonModel(
	systemContent: string,
	userPrompt: string,
	options: { format: Record<string, unknown>; maxTokens: number },
): Promise<{ model: string; parsed: Record<string, unknown> }> {
	const runtime = getDigestLlmRuntime(process.env);
	if (runtime.mode !== 'local' || !runtime.model) {
		throw new Error('Local digest LLM runtime is not configured');
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

	const messages = [
		{ role: 'system', content: systemContent },
		{ role: 'user', content: userPrompt },
	];
	const text = await requestLocalDigestText(runtime, headers, messages, options);

	try {
		return {
			model: runtime.model,
			parsed: parseJsonObject(text),
		};
	} catch (parseError) {
		const repairedText = await requestLocalDigestText(
			runtime,
			headers,
			[
				{ role: 'system', content: LOCAL_DIGEST_JSON_REPAIR_KERNEL },
				{
					role: 'user',
					content: `Repair this malformed JSON so it matches the requested JSON shape.\n\nRequested JSON shape:\n${JSON.stringify(
						options.format,
					)}\n\nMalformed JSON:\n${text}`,
				},
			],
			{
				...options,
				maxTokens: Math.min(Math.max(options.maxTokens, 1024), 8192),
			},
		);
		try {
			return {
				model: runtime.model,
				parsed: parseJsonObject(repairedText),
			};
		} catch (repairError) {
			throw new Error(
				`Local digest returned malformed JSON and repair failed: ${(parseError as Error).message}; ${(repairError as Error).message}`,
			);
		}
	}
}

async function requestLocalDigestText(
	runtime: DigestLlmRuntime,
	headers: Record<string, string>,
	messages: Array<{ role: string; content: string }>,
	options: { format: Record<string, unknown>; maxTokens: number },
): Promise<string> {
	const response =
		runtime.api === 'ollama'
			? await fetch(runtime.ollamaChatUrl ?? '', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: runtime.model,
						messages,
						stream: false,
						think: false,
						format: options.format,
						options: {
							temperature: 0.3,
							num_predict: options.maxTokens,
						},
					}),
				})
			: await fetch(runtime.chatCompletionsUrl ?? '', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: runtime.model,
						messages,
						temperature: 0.3,
						max_tokens: options.maxTokens,
						response_format: { type: 'json_object' },
					}),
				});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Local digest LLM error (${response.status}): ${error}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
		message?: { content?: string | null };
	};
	const text =
		runtime.api === 'ollama'
			? data.message?.content?.trim()
			: data.choices?.[0]?.message?.content?.trim();
	if (!text) throw new Error('Local digest LLM returned no message content');
	return text;
}

function formatConversationSummaries(conversations: DigestPromptConversation[]): string {
	return conversations
		.map(({ displayName, msgs, representativeMessages }) => {
			const count = msgs.length;
			const representative = representativeMessages.map((m) => `  ${m.content}`).join('\n');
			return `${displayName} (${count} sampled messages):\n${representative}`;
		})
		.join('\n\n');
}

function chunkDigestPromptConversations(
	conversations: DigestPromptConversation[],
	maxMessagesPerBatch: number,
	maxBatches: number,
): DigestPromptConversation[][] {
	if (conversations.length === 0) return [];

	const batches: DigestPromptConversation[][] = [];
	let current: DigestPromptConversation[] = [];
	let currentMessageCount = 0;

	for (const conversation of conversations) {
		const conversationMessageCount = Math.max(1, conversation.representativeMessages.length);
		const shouldStartNextBatch =
			current.length > 0 &&
			currentMessageCount + conversationMessageCount > maxMessagesPerBatch &&
			batches.length < maxBatches - 1;

		if (shouldStartNextBatch) {
			batches.push(current);
			current = [];
			currentMessageCount = 0;
		}

		current.push(conversation);
		currentMessageCount += conversationMessageCount;
	}

	if (current.length > 0) batches.push(current);
	return batches;
}

function batchMessageCount(conversations: DigestPromptConversation[]): number {
	return conversations.reduce(
		(total, conversation) => total + conversation.representativeMessages.length,
		0,
	);
}

function shouldBatchLocalDigest(promptMessageCount: number): boolean {
	return DIGEST_BATCHING_ENABLED && promptMessageCount > DIGEST_BATCH_MESSAGE_COUNT;
}

function buildDigestUserPrompt(params: {
	periodLabel: string;
	focusInstruction: string;
	sourceCoverage: DigestSourceCoverage;
	omittedContactCount: number;
	commitmentCount: number;
	commitmentList: string;
	dealCount: number;
	dealList: string;
	contextHeading: string;
	contextBody: string;
	contextInstruction?: string;
}): string {
	const batchCoverageLines = params.sourceCoverage.batch_count
		? `- Local Qwen batch summaries: ${params.sourceCoverage.batch_count}
- Message excerpts summarized in batches: ${
				params.sourceCoverage.batch_messages ?? params.sourceCoverage.prompt_messages
			}
- Batch strategy: ${params.sourceCoverage.batch_strategy}`
		: '';

	return `Generate a digest for the period: ${params.periodLabel}
${params.focusInstruction}

Source coverage:
- Total period messages: ${params.sourceCoverage.total_messages}
- Messages sampled from the period: ${params.sourceCoverage.sampled_messages}
- Message excerpts shown below: ${params.sourceCoverage.prompt_messages}
- Active conversations in period: ${params.sourceCoverage.total_conversations}
- Conversations represented in sample: ${params.sourceCoverage.sampled_conversations}
- Conversations shown below: ${params.sourceCoverage.prompt_conversations}
- Sampling strategy: ${params.sourceCoverage.sample_strategy}
- Omitted sampled conversations: ${params.omittedContactCount}
${batchCoverageLines}

Use the total period counts for activity_overview.message_count and activity_overview.active_conversations.
Do not imply that every message was read in detail when sampled_messages is lower than total_messages.
${params.contextInstruction ? `\n${params.contextInstruction}` : ''}

Active Commitments (${params.commitmentCount}):
${params.commitmentList || 'None'}

Active Deals (${params.dealCount}):
${params.dealList || 'None'}

${params.contextHeading}:
${params.contextBody || 'No messages in this period'}

Return a structured digest object using the required digest schema.`;
}

function buildDigestBatchPrompt(params: {
	periodLabel: string;
	batchIndex: number;
	batchCount: number;
	sourceCoverage: DigestSourceCoverage;
	conversations: DigestPromptConversation[];
}): string {
	const messageCount = batchMessageCount(params.conversations);
	return `Summarize local digest evidence batch ${params.batchIndex} of ${params.batchCount} for the period: ${params.periodLabel}

Overall source coverage:
- Total period messages: ${params.sourceCoverage.total_messages}
- Messages sampled from the period: ${params.sourceCoverage.sampled_messages}
- Active conversations in period: ${params.sourceCoverage.total_conversations}
- Sampling strategy: ${params.sourceCoverage.sample_strategy}

This batch:
- Message excerpts: ${messageCount}
- Conversations: ${params.conversations.length}

Representative conversations in this batch:
${formatConversationSummaries(params.conversations) || 'No messages in this batch'}

Return only a compact JSON summary for this batch.`;
}

function formatBatchSummariesForPrompt(batchSummaries: DigestBatchSummary[]): string {
	return batchSummaries
		.map((batch) => {
			const highlights = batch.highlights.map((item) => `  - ${item}`).join('\n') || '  - None';
			const keyConversations =
				batch.keyConversations
					.map((item) => `  - ${item.contact_ref}: ${item.summary}`)
					.join('\n') || '  - None';
			const actionItems =
				batch.actionItems
					.map(
						(item) =>
							`  - [${item.priority}] ${item.item}${item.contact_ref ? ` (${item.contact_ref})` : ''}`,
					)
					.join('\n') || '  - None';
			const watchList =
				batch.watchList.map((item) => `  - ${item.contact_ref}: ${item.reason}`).join('\n') ||
				'  - None';

			return `Batch ${batch.batchIndex} (${batch.messageCount} excerpts, ${batch.conversationCount} conversations):
Summary: ${batch.summary}
Highlights:
${highlights}
Key conversations:
${keyConversations}
Action items:
${actionItems}
Watch list:
${watchList}`;
		})
		.join('\n\n');
}

async function summarizeLocalDigestBatches(
	systemKernel: string,
	periodLabel: string,
	sourceCoverage: DigestSourceCoverage,
	batches: DigestPromptConversation[][],
): Promise<DigestBatchSummary[]> {
	const summaries: DigestBatchSummary[] = [];
	for (const [index, batch] of batches.entries()) {
		const batchNumber = index + 1;
		const prompt = buildDigestBatchPrompt({
			periodLabel,
			batchIndex: batchNumber,
			batchCount: batches.length,
			sourceCoverage,
			conversations: batch,
		});
		const local = await callLocalDigestBatchModel(systemKernel, prompt);
		summaries.push(
			normalizeDigestBatchSummary(
				local.summary,
				batchNumber,
				batchMessageCount(batch),
				batch.length,
			),
		);
	}
	return summaries;
}

export async function generateDigest(
	input: DigestInput,
	envelope: SealedEnvelope,
): Promise<DigestResult> {
	// 1. Select variants via Thompson Sampling
	const [styleSelection, toneSelection] = await Promise.all([
		selectPromptVariant('digest_style', STYLE_VARIANTS, input.userId),
		selectPromptVariant('digest_tone', TONE_VARIANTS, input.userId),
	]);

	// 2. Fetch data for the time period
	const [commitments, deals] = await Promise.all([
		getActiveCommitments(input.workspaceId, envelope, { limit: 30 }),
		listDeals(input.workspaceId, envelope, { limit: 20 }),
	]);

	// 3. Fetch a time-spread context sample for the period.
	const digestContext = await getDigestContextMessages(
		input.workspaceId,
		input.periodStart,
		input.periodEnd,
		envelope,
	);
	const messages: DigestPromptMessage[] = digestContext.rows.map((m) => ({
		chatId: m.chatId,
		contactId: m.contactId ?? '',
		conversationId: m.contactId ?? `chat:${m.chatId}`,
		content: m.text ?? '',
		sentAt: m.sentAt.toISOString(),
		senderName: '',
	}));

	// 4. Mask entities in message content
	const maskedMessages = messages.map((m) => {
		const detected = prefilterEntities(m.content);
		const { maskedText } = maskEntities(m.content, input.workspaceSalt, detected);
		return { ...m, content: maskedText };
	});

	// 5. Group messages by conversation. Contactless messages fall back to chat ID.
	const byConversation = new Map<string, typeof maskedMessages>();
	for (const msg of maskedMessages) {
		const existing = byConversation.get(msg.conversationId) ?? [];
		existing.push(msg);
		byConversation.set(msg.conversationId, existing);
	}

	// 5b. Resolve contact names for human-readable digest output
	const contactIds = [
		...new Set(
			maskedMessages.map((message) => message.contactId).filter((id): id is string => Boolean(id)),
		),
	];
	const chatIds = [
		...new Set(
			maskedMessages
				.filter((message) => !message.contactId)
				.map((message) => message.chatId)
				.filter(Boolean),
		),
	];
	const contactNameMap = new Map<string, string>();
	if (contactIds.length > 0) {
		try {
			const contactRows = await getContactsByIds(input.workspaceId, contactIds, envelope);
			for (const c of contactRows) {
				const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
				if (name) contactNameMap.set(c.id, name);
			}
		} catch {
			// Non-fatal — fall back to "Contact" label
		}
	}
	const chatNameMap = new Map<string, string>();
	if (chatIds.length > 0) {
		try {
			const chatRows = await getChatsByIds(input.workspaceId, chatIds, envelope);
			for (const chat of chatRows) {
				const name = chat.title || chat.username || `${chat.type} conversation`;
				chatNameMap.set(chat.id, name);
			}
		} catch {
			// Non-fatal — fall back to generic conversation label.
		}
	}

	// 6. Build the user prompt with focus emphasis
	const focusInstruction =
		input.digestFocus !== 'balanced'
			? `\n\nFOCUS: Emphasize ${input.digestFocus} over other sections.`
			: '';

	const commitmentList = commitments
		.map((c) => {
			const dueStr = c.dueDate ? `due ${new Date(c.dueDate).toLocaleDateString()}` : 'no due date';
			return `- [${c.commitmentType}] ${c.title} (${dueStr}, assignee: ${c.assignee}, status: ${c.status})`;
		})
		.join('\n');

	const dealList = deals
		.map((d: Record<string, unknown>) => `- ${d.title}: ${d.status}`)
		.join('\n');

	const contactSummaries = Array.from(byConversation.entries())
		.map(([conversationId, msgs]) => ({
			conversationId,
			displayName: msgs[0]?.contactId
				? (contactNameMap.get(msgs[0].contactId) ?? 'Unknown Contact')
				: (chatNameMap.get(msgs[0]?.chatId ?? '') ?? 'Group conversation'),
			latestSentAt: msgs[msgs.length - 1]?.sentAt ?? '',
			msgs,
		}))
		.sort((a, b) => {
			const countDelta = b.msgs.length - a.msgs.length;
			if (countDelta !== 0) return countDelta;
			return b.latestSentAt.localeCompare(a.latestSentAt);
		});
	const promptContactSummaries = contactSummaries.slice(0, DIGEST_CONTEXT_MAX_CONTACTS);
	const omittedContactCount = Math.max(0, contactSummaries.length - promptContactSummaries.length);
	const promptConversationSummaries = promptContactSummaries.map(({ displayName, msgs }) => ({
		displayName,
		msgs,
		representativeMessages: selectRepresentativeMessages(msgs, DIGEST_CONTEXT_MESSAGES_PER_CONTACT),
	}));
	const promptMessageCount = promptConversationSummaries.reduce(
		(total, summary) => total + summary.representativeMessages.length,
		0,
	);
	const sourceCoverage: DigestSourceCoverage = {
		message_budget: DIGEST_CONTEXT_MESSAGE_BUDGET,
		prompt_conversations: promptContactSummaries.length,
		prompt_messages: promptMessageCount,
		sample_strategy: digestContext.sampleStrategy,
		sampled_conversations: byConversation.size,
		sampled_messages: maskedMessages.length,
		total_conversations: digestContext.totalContactCount,
		total_messages: digestContext.totalMessageCount,
	};
	const conversationSummaries = formatConversationSummaries(promptConversationSummaries);

	const periodLabel = `${input.periodStart.toLocaleDateString()} - ${input.periodEnd.toLocaleDateString()}`;

	// 7. Build system kernel with variant modifiers
	const styleModifier = STYLE_MODIFIERS[styleSelection.variant] ?? '';
	const toneModifier = TONE_MODIFIERS[toneSelection.variant] ?? '';
	const systemKernel = DIGEST_SYSTEM_KERNEL + styleModifier + toneModifier;

	const banditArm = `${styleSelection.variant}+${toneSelection.variant}`;
	const digestRuntime = getDigestLlmRuntime(process.env);

	if (digestRuntime.mode === 'local') {
		let contextHeading = 'Representative conversations';
		let contextBody = conversationSummaries;
		let contextInstruction: string | undefined;

		if (shouldBatchLocalDigest(promptMessageCount)) {
			const batches = chunkDigestPromptConversations(
				promptConversationSummaries,
				DIGEST_BATCH_MESSAGE_COUNT,
				DIGEST_BATCH_MAX_BATCHES,
			);
			if (batches.length > 1) {
				const batchSummaries = await summarizeLocalDigestBatches(
					systemKernel,
					periodLabel,
					sourceCoverage,
					batches,
				);
				sourceCoverage.batch_count = batchSummaries.length;
				sourceCoverage.batch_messages = promptMessageCount;
				sourceCoverage.batch_strategy = `local-qwen-map-reduce:${batchSummaries.length}x~${DIGEST_BATCH_MESSAGE_COUNT}`;
				contextHeading = 'Local Qwen batch summaries';
				contextBody = formatBatchSummariesForPrompt(batchSummaries);
				contextInstruction =
					'The batch summaries are compressed evidence from the representative message excerpts. Do not treat them as additional messages beyond the source coverage counts.';
			}
		}

		const localPrompt = buildDigestUserPrompt({
			periodLabel,
			focusInstruction,
			sourceCoverage,
			omittedContactCount,
			commitmentCount: commitments.length,
			commitmentList,
			dealCount: deals.length,
			dealList,
			contextHeading,
			contextBody,
			contextInstruction,
		});
		const local = await callLocalDigestModel(systemKernel, localPrompt);
		const sections = normalizeDigestSections(
			local.sections,
			digestContext.totalMessageCount,
			digestContext.totalContactCount,
			sourceCoverage,
		);
		sections.activity_overview.message_count = digestContext.totalMessageCount;
		sections.activity_overview.active_conversations = digestContext.totalContactCount;
		return {
			content: JSON.stringify(sections, null, 2),
			sections,
			model: local.model,
			messageCount: digestContext.totalMessageCount,
			contactCount: digestContext.totalContactCount,
			styleTraceId: styleSelection.traceId,
			toneTraceId: toneSelection.traceId,
			styleVariant: styleSelection.variant,
			toneVariant: toneSelection.variant,
		};
	}

	// 8. Call cloud inference only when digest is not configured for local Qwen.
	const userPrompt = buildDigestUserPrompt({
		periodLabel,
		focusInstruction,
		sourceCoverage,
		omittedContactCount,
		commitmentCount: commitments.length,
		commitmentList,
		dealCount: deals.length,
		dealList,
		contextHeading: 'Representative conversations',
		contextBody: conversationSummaries,
	});

	const response = await inferWithCache(
		systemKernel,
		'',
		'',
		[{ role: 'user', content: userPrompt }],
		{
			maxTokens: 4096,
			temperature: 0.3,
			tools: [DIGEST_TOOL],
			helicone: { feature: 'daily-digest', banditArm },
		},
	);

	// 9. Extract structured output from tool_use
	const toolBlock = response.content.find((b) => b.type === 'tool_use');
	const sections = toolBlock && toolBlock.type === 'tool_use' ? toolBlock.input : null;

	// 10. Also get the text content for plain rendering
	const textContent = response.content
		.filter((b) => b.type === 'text')
		.map((b) => (b.type === 'text' ? b.text : ''))
		.join('\n');

	return {
		content: textContent || JSON.stringify(sections, null, 2),
		sections: {
			...(objectValue(sections) as Record<string, unknown>),
			source_coverage: sourceCoverage,
		},
		model: 'claude-sonnet-4-6',
		messageCount: digestContext.totalMessageCount,
		contactCount: digestContext.totalContactCount,
		styleTraceId: styleSelection.traceId,
		toneTraceId: toneSelection.traceId,
		styleVariant: styleSelection.variant,
		toneVariant: toneSelection.variant,
	};
}

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { maskEntities } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import {
	getActiveCommitments,
	getContactsByIds,
	getMessagesByTimeRange,
	listDeals,
} from '@repo/db';
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

	// 3. Fetch messages for the time period
	const rawMessages = await getMessagesByTimeRange(
		input.workspaceId,
		input.periodStart,
		input.periodEnd,
		envelope,
		{ limit: 200 },
	);
	const messages: Array<{
		contactId: string;
		content: string;
		sentAt: string;
		senderName: string;
	}> = rawMessages.map((m) => ({
		contactId: m.contactId ?? '',
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

	// 5. Group messages by contact
	const byContact = new Map<string, typeof maskedMessages>();
	for (const msg of maskedMessages) {
		const existing = byContact.get(msg.contactId) ?? [];
		existing.push(msg);
		byContact.set(msg.contactId, existing);
	}

	// 5b. Resolve contact names for human-readable digest output
	const contactIds = [...byContact.keys()].filter(Boolean);
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

	const conversationSummaries = Array.from(byContact.entries())
		.map(([contactId, msgs]) => {
			const displayName = contactNameMap.get(contactId) ?? 'Unknown Contact';
			const count = msgs.length;
			const recent = msgs
				.slice(-5)
				.map((m) => `  ${m.content}`)
				.join('\n');
			return `${displayName} (${count} messages):\n${recent}`;
		})
		.join('\n\n');

	const periodLabel = `${input.periodStart.toLocaleDateString()} - ${input.periodEnd.toLocaleDateString()}`;

	const userPrompt = `Generate a digest for the period: ${periodLabel}
${focusInstruction}

Active Commitments (${commitments.length}):
${commitmentList || 'None'}

Active Deals (${deals.length}):
${dealList || 'None'}

Conversations (${maskedMessages.length} total messages across ${byContact.size} contacts):
${conversationSummaries || 'No messages in this period'}

Use the generate_digest tool to return structured output.`;

	// 7. Build system kernel with variant modifiers
	const styleModifier = STYLE_MODIFIERS[styleSelection.variant] ?? '';
	const toneModifier = TONE_MODIFIERS[toneSelection.variant] ?? '';
	const systemKernel = DIGEST_SYSTEM_KERNEL + styleModifier + toneModifier;

	// 8. Call Claude via cached inference
	const banditArm = `${styleSelection.variant}+${toneSelection.variant}`;
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
		sections,
		model: 'claude-sonnet-4-6',
		messageCount: maskedMessages.length,
		contactCount: byContact.size,
		styleTraceId: styleSelection.traceId,
		toneTraceId: toneSelection.traceId,
		styleVariant: styleSelection.variant,
		toneVariant: toneSelection.variant,
	};
}

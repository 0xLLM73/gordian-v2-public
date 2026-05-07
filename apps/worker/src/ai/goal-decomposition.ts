import Anthropic from '@anthropic-ai/sdk';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecompositionContext {
	goalTitle: string;
	goalType: string;
	paceScore: number | null;
	/** Human-readable pace description */
	paceLabel: string;
	/** Top contact matches from KG (masked names) */
	contactFits: Array<{
		contactId: string;
		displayName: string;
		matchReason: string;
		healthLabel: string;
	}>;
	/** Relevant knowledge graph triplets (already ELM-masked) */
	kgTriplets: Array<{
		nodeType: string;
		displayName: string;
		description: string | null;
	}>;
	/** Recent progress events */
	progressEvents: Array<{
		delta: number;
		source: string;
		createdAt: string;
	}>;
}

export interface DecomposedAction {
	title: string;
	description: string;
	suggestedContactId: string | null;
	actionType:
		| 'contact_outreach'
		| 'information_gathering'
		| 'document_creation'
		| 'meeting_scheduling'
		| 'decision_making';
	domainTag: 'financial' | 'networking' | 'legal' | 'technical' | 'operational' | 'other';
	effort: 'quick' | 'medium' | 'deep';
	matchReason: string;
}

export interface DecompositionResult {
	actions: DecomposedAction[];
	reasoning: string;
}

// ─── Tool Schema ──────────────────────────────────────────────────────────────

const VALID_ACTION_TYPES = [
	'contact_outreach',
	'information_gathering',
	'document_creation',
	'meeting_scheduling',
	'decision_making',
] as const;

const VALID_DOMAIN_TAGS = [
	'financial',
	'networking',
	'legal',
	'technical',
	'operational',
	'other',
] as const;

const VALID_EFFORTS = ['quick', 'medium', 'deep'] as const;

const DECOMPOSE_GOAL_TOOL: Anthropic.Messages.Tool = {
	name: 'decompose_goal',
	description:
		'Break down a goal into 3-5 atomic, single-step actions. Each action must be completable in one step without further decomposition.',
	input_schema: {
		type: 'object' as const,
		properties: {
			reasoning: {
				type: 'string',
				description:
					'Brief chain of thought: prerequisite ordering and how observations from the knowledge graph informed the plan.',
			},
			actions: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						title: {
							type: 'string',
							description: 'Clear, actionable title for this step. Max 100 chars.',
						},
						description: {
							type: 'string',
							description:
								'What specifically to do and why. Reference knowledge graph context if relevant.',
						},
						suggested_contact_id: {
							type: 'string',
							description:
								'UUID of the most relevant contact from the provided list, or null if no contact fits.',
						},
						action_type: {
							type: 'string',
							enum: [...VALID_ACTION_TYPES],
							description: 'Category of action.',
						},
						domain_tag: {
							type: 'string',
							enum: [...VALID_DOMAIN_TAGS],
							description: 'Domain this action falls under.',
						},
						effort: {
							type: 'string',
							enum: [...VALID_EFFORTS],
							description: 'Effort estimate. quick=<30min, medium=1-3hrs, deep=half-day+.',
						},
						match_reason: {
							type: 'string',
							description:
								'Why this action and contact were chosen, grounded in knowledge graph data.',
						},
					},
					required: ['title', 'description', 'action_type', 'domain_tag', 'effort', 'match_reason'],
				},
				minItems: 3,
				maxItems: 5,
			},
		},
		required: ['reasoning', 'actions'],
	},
};

// ─── System Prompt (Hybrid LtM + ReAct) ──────────────────────────────────────

const DECOMPOSITION_KERNEL = `You are a personal chief of staff for a VC/crypto professional. Your job is to decompose a strategic goal into 3-5 atomic actions — each completable in a single step.

## Method: Least-to-Most with Observation Grounding

1. **Identify prerequisites**: What must happen first? Order actions by dependency.
2. **Ground in observations**: Use the knowledge graph data provided to suggest specific contacts and actions. Reference actual entities, not hypothetical ones.
3. **Validate atomicity**: Each action must be completable in ONE step. If it requires sub-steps, decompose further.

## Rules

- Output exactly 3-5 actions. No more, no less.
- Each action title must be under 100 characters.
- Suggest contacts ONLY from the provided contact list. Use their exact contact_id.
- If no contact fits an action, set suggested_contact_id to null.
- Action types are constrained: contact_outreach, information_gathering, document_creation, meeting_scheduling, decision_making.
- Domain tags are constrained: financial, networking, legal, technical, operational, other.
- Effort: quick (<30 min), medium (1-3 hours), deep (half-day+).
- Never fabricate contacts, knowledge, or relationships not in the provided data.
- If the goal is behind pace, prioritize high-impact actions that accelerate progress.
- For at-risk goals (pace < 0.75), include at least one "quick win" action.`;

// ─── Core Function ────────────────────────────────────────────────────────────

/**
 * Decompose a goal into 3-5 atomic actions using Hybrid LtM + ReAct prompting.
 *
 * Context injection uses GraphRAG (KG triplets + contact scores), NOT raw messages.
 * All input must be ELM-masked before calling this function.
 */
export async function decomposeGoal(context: DecompositionContext): Promise<DecompositionResult> {
	const client = new Anthropic({
		defaultHeaders: {
			'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
			'Helicone-Property-Feature': 'goal-decomposition',
			'Helicone-Property-Goal-Type': context.goalType,
		},
		baseURL: process.env.HELICONE_API_KEY ? 'https://anthropic.helicone.ai/v1' : undefined,
	});

	// Build structured context for the prompt
	const userPrompt = buildUserPrompt(context);

	const response = await client.messages.create({
		model: HAIKU_MODEL,
		max_tokens: 2048,
		temperature: 0.4,
		system: DECOMPOSITION_KERNEL,
		tools: [DECOMPOSE_GOAL_TOOL],
		tool_choice: { type: 'tool', name: 'decompose_goal' },
		messages: [{ role: 'user', content: userPrompt }],
	});

	// Extract tool use result
	const toolBlock = response.content.find(
		(block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
	);

	if (!toolBlock) {
		console.error('[goal-decomposition] No tool_use block in response');
		return { actions: [], reasoning: 'LLM did not return structured output' };
	}

	const result = toolBlock.input as {
		reasoning: string;
		actions: Array<{
			title: string;
			description: string;
			suggested_contact_id?: string | null;
			action_type: string;
			domain_tag: string;
			effort: string;
			match_reason: string;
		}>;
	};

	// Validate and normalize actions
	const actions = normalizeActions(result.actions, context.contactFits);

	return {
		actions,
		reasoning: result.reasoning || '',
	};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUserPrompt(context: DecompositionContext): string {
	const sections: string[] = [];

	// Goal overview
	sections.push(`## Goal
- Title: ${context.goalTitle}
- Type: ${context.goalType}
- Pace: ${context.paceLabel}${context.paceScore != null ? ` (score: ${context.paceScore.toFixed(2)})` : ''}`);

	// Knowledge graph observations (ReAct grounding)
	if (context.kgTriplets.length > 0) {
		const tripletLines = context.kgTriplets
			.slice(0, 10)
			.map((t) => `- [${t.nodeType}] ${t.displayName}${t.description ? `: ${t.description}` : ''}`);
		sections.push(`## Observations (Knowledge Graph)\n${tripletLines.join('\n')}`);
	} else {
		sections.push('## Observations (Knowledge Graph)\nNo relevant knowledge graph data available.');
	}

	// Available contacts
	if (context.contactFits.length > 0) {
		const contactLines = context.contactFits.map(
			(c) =>
				`- contact_id: ${c.contactId} | name: ${c.displayName} | match: ${c.matchReason} | health: ${c.healthLabel}`,
		);
		sections.push(
			`## Available Contacts (Top ${context.contactFits.length})\n${contactLines.join('\n')}`,
		);
	} else {
		sections.push('## Available Contacts\nNo contacts matched via knowledge graph.');
	}

	// Recent progress
	if (context.progressEvents.length > 0) {
		const eventLines = context.progressEvents.map(
			(e) => `- ${e.createdAt}: +${e.delta} (${e.source})`,
		);
		sections.push(`## Recent Progress\n${eventLines.join('\n')}`);
	} else {
		sections.push('## Recent Progress\nNo progress events recorded yet.');
	}

	sections.push(
		'Decompose this goal into 3-5 atomic actions. Use the knowledge graph observations to ground your suggestions in real data.',
	);

	return sections.join('\n\n');
}

/**
 * Validate and normalize LLM output actions.
 * Constrains values to valid enums and validates contact IDs against provided list.
 */
function normalizeActions(
	rawActions: Array<{
		title: string;
		description: string;
		suggested_contact_id?: string | null;
		action_type: string;
		domain_tag: string;
		effort: string;
		match_reason: string;
	}>,
	contactFits: DecompositionContext['contactFits'],
): DecomposedAction[] {
	const validContactIds = new Set(contactFits.map((c) => c.contactId));

	return rawActions
		.slice(0, 5) // Hard cap at 5
		.map((raw) => ({
			title: (raw.title || 'Untitled action').slice(0, 100),
			description: raw.description || '',
			suggestedContactId:
				raw.suggested_contact_id && validContactIds.has(raw.suggested_contact_id)
					? raw.suggested_contact_id
					: null,
			actionType: VALID_ACTION_TYPES.includes(
				raw.action_type as (typeof VALID_ACTION_TYPES)[number],
			)
				? (raw.action_type as DecomposedAction['actionType'])
				: 'information_gathering',
			domainTag: VALID_DOMAIN_TAGS.includes(raw.domain_tag as (typeof VALID_DOMAIN_TAGS)[number])
				? (raw.domain_tag as DecomposedAction['domainTag'])
				: 'other',
			effort: VALID_EFFORTS.includes(raw.effort as (typeof VALID_EFFORTS)[number])
				? (raw.effort as DecomposedAction['effort'])
				: 'medium',
			matchReason: raw.match_reason || '',
		}));
}

// ─── Pace Score ───────────────────────────────────────────────────────────────

/**
 * Compute pace score for a goal. Mirrors morning-brief.ts logic.
 * Returns null for goals without a target date.
 */
export function computePaceScore(goal: {
	currentCount: number;
	targetCount: number;
	targetDate: Date | string | null;
	createdAt: Date | string;
}): { score: number | null; label: string } {
	if (!goal.targetDate || goal.targetCount === 0) {
		const progress = goal.targetCount > 0 ? goal.currentCount / goal.targetCount : 1;
		return { score: null, label: progress >= 1 ? 'complete' : 'no deadline set' };
	}

	const now = Date.now();
	const created = new Date(goal.createdAt).getTime();
	const deadline = new Date(goal.targetDate).getTime();
	const totalDays = Math.max(1, (deadline - created) / 86400000);
	const daysElapsed = Math.max(1, (now - created) / 86400000);
	const daysLeft = Math.max(0, Math.ceil((deadline - now) / 86400000));

	const progress = goal.currentCount / goal.targetCount;
	const timeProgress = daysElapsed / totalDays;
	const score = timeProgress > 0 ? progress / timeProgress : 1;

	let label = 'on track';
	if (daysLeft <= 7) label = 'deadline approaching';
	else if (score < 0.75) label = 'at risk';
	else if (score < 0.9) label = 'behind pace';

	return { score, label };
}

/**
 * Check if pace score indicates replanning is needed.
 * Threshold: < 0.75 (from Q5 research — belief state divergence trigger).
 */
export function needsReplanning(paceScore: number | null): boolean {
	return paceScore !== null && paceScore < 0.75;
}

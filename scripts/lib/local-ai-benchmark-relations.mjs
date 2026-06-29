const RELATION_TYPES = [
	'AFFILIATED_WITH',
	'WORKS_ON',
	'OWNS_OR_RESPONSIBLE_FOR',
	'INTERESTED_IN',
	'REQUESTED',
	'USES',
	'PART_OF',
	'DEPENDS_ON',
	'ALTERNATIVE_TO',
	'RELATED_TO',
];

const DIRECTIONS = ['head_to_tail', 'tail_to_head', 'undirected'];
const TEMPORAL_STATUSES = ['current', 'past', 'future', 'unknown'];

function isRecord(input) {
	return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function assertArray(input, name) {
	if (!Array.isArray(input)) throw new Error(`${name} is not an array`);
	return input;
}

function exactQuoteInSource(quote, source) {
	return typeof quote === 'string' && quote.length > 0 && source.includes(quote);
}

const RELATION_TYPE_ALIASES = new Map([
	['affiliated', 'AFFILIATED_WITH'],
	['affiliated_with', 'AFFILIATED_WITH'],
	['member_of', 'AFFILIATED_WITH'],
	['works_with', 'AFFILIATED_WITH'],
	['working_with', 'AFFILIATED_WITH'],
	['owns', 'OWNS_OR_RESPONSIBLE_FOR'],
	['owns_or_responsible_for', 'OWNS_OR_RESPONSIBLE_FOR'],
	['requested', 'REQUESTED'],
	['requests', 'REQUESTED'],
	['use', 'USES'],
	['used_to_use', 'USES'],
	['using', 'USES'],
	['uses', 'USES'],
	['working_on', 'WORKS_ON'],
	['works_on', 'WORKS_ON'],
]);

function normalizeRelationType(value) {
	if (typeof value !== 'string') return value;
	const normalized = value.trim().replace(/[\s-]+/g, '_');
	return RELATION_TYPE_ALIASES.get(normalized.toLowerCase()) ?? normalized.toUpperCase();
}

function normalizeTemporalStatus(value) {
	if (typeof value !== 'string') return value == null ? 'unknown' : value;
	const normalized = value
		.trim()
		.replace(/[\s-]+/g, '_')
		.toLowerCase();
	if (TEMPORAL_STATUSES.includes(normalized)) return normalized;
	if (
		normalized.includes('past') ||
		normalized.includes('stale') ||
		normalized.includes('historical') ||
		normalized.includes('superseded') ||
		normalized.includes('used_to') ||
		normalized.includes('former') ||
		normalized.includes('no_longer')
	) {
		return 'past';
	}
	if (
		normalized.includes('future') ||
		normalized.includes('planned') ||
		normalized.includes('upcoming')
	) {
		return 'future';
	}
	if (normalized.includes('current') || normalized.includes('active')) return 'current';
	return normalized;
}

function normalizeBoolean(value) {
	if (typeof value === 'boolean') return value;
	if (typeof value !== 'string') return value;
	const normalized = value.trim().toLowerCase();
	if (['true', 'yes', '1'].includes(normalized)) return true;
	if (['false', 'no', '0'].includes(normalized)) return false;
	return value;
}

function normalizeSourceMessageId(value) {
	if (typeof value !== 'string') return value;
	const sourceMatch = value.match(/\[?source:([^\]\s]+)\]?/i);
	if (sourceMatch?.[1]) return sourceMatch[1];
	return value.trim().replace(/^\[|\]$/g, '');
}

function normalizeRelationOutput(relation) {
	if (!isRecord(relation)) return relation;
	return {
		...relation,
		head_mention:
			relation.head_mention ??
			relation.headMention ??
			relation.subject_node ??
			relation.subjectNode ??
			relation.subject,
		relation_type: normalizeRelationType(
			relation.relation_type ??
				relation.relationType ??
				relation.predicate ??
				relation.relationship_type ??
				relation.relationshipType,
		),
		tail_mention:
			relation.tail_mention ??
			relation.tailMention ??
			relation.object_node ??
			relation.objectNode ??
			relation.object,
		source_message_id: normalizeSourceMessageId(
			relation.source_message_id ?? relation.sourceMessageId ?? relation.message_id,
		),
		direction:
			typeof relation.direction === 'string'
				? relation.direction.trim().toLowerCase()
				: relation.direction,
		temporal_status: normalizeTemporalStatus(relation.temporal_status ?? relation.temporalStatus),
		is_explicit: normalizeBoolean(relation.is_explicit ?? relation.isExplicit),
		negated: normalizeBoolean(relation.negated),
		confirmed_eligible: normalizeBoolean(
			relation.confirmed_eligible ?? relation.confirmedEligible ?? relation.promotable,
		),
	};
}

function relationSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			relations: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						head_mention: { type: 'string' },
						head_node_id: { type: ['string', 'null'] },
						relation_type: { type: 'string', enum: RELATION_TYPES },
						tail_mention: { type: 'string' },
						tail_node_id: { type: ['string', 'null'] },
						direction: { type: 'string', enum: DIRECTIONS },
						source_message_id: { type: 'string' },
						quote: { type: 'string' },
						char_start: { type: 'number' },
						char_end: { type: 'number' },
						is_explicit: { type: 'boolean' },
						negated: { type: 'boolean' },
						temporal_status: { type: 'string', enum: TEMPORAL_STATUSES },
						confirmed_eligible: { type: 'boolean' },
						rationale: { type: 'string' },
					},
					required: [
						'head_mention',
						'relation_type',
						'tail_mention',
						'direction',
						'source_message_id',
						'quote',
						'is_explicit',
						'negated',
						'temporal_status',
						'confirmed_eligible',
						'rationale',
					],
				},
			},
		},
		required: ['relations'],
	};
}

function relationMessages(testCase) {
	return [
		{
			role: 'system',
			content:
				'Extract evidence-grounded CRM knowledge graph relationships. Return JSON only. Every relation object must include head_mention, relation_type, tail_mention, direction, source_message_id, quote, is_explicit, negated, temporal_status, confirmed_eligible, and rationale. Every quote must be an exact substring from the transcript and every source_message_id must exist. confirmed_eligible may be true only when is_explicit=true, negated=false, temporal_status="current", the source marker is not unattributed, and the quote exactly supports the relation. Set confirmed_eligible=false for negated, inferred, past/stale, future/unknown, unattributed-person, or co-mention-only relationships. If a transcript line starts like "[source:m1 unattributed]", use source_message_id="m1" but confirmed_eligible=false for every relation from that line. If the source explicitly states a negated relationship, return the relation with negated=true, temporal_status="past", and confirmed_eligible=false instead of omitting it. For directed relations, put the actor/source/dependent/member/requester/owner in head_mention and use direction="head_to_tail"; use undirected only for RELATED_TO. AFFILIATED_WITH is directional: person/contact head_to_tail organization. Phrases like "Alice at Acme", "Jordan with Orbit Labs", or "not working with Acme anymore" indicate AFFILIATED_WITH, not WORKS_ON, unless the text explicitly says working on a project. "Cara requested the security review" is a current REQUESTED relation. "We used to use HubSpot before moving to Attio" should produce two USES relations: past/not-confirmed for HubSpot and current/confirmed for Attio. Do not create relations from co-mentions such as "mentioned X and Y"; return {"relations":[]} when no explicit relationship is stated. Include char_start and char_end only when you are certain they exactly span the quote.',
		},
		{
			role: 'user',
			content: `Known node mentions: ${testCase.nodeMentions.join(', ')}\nTranscript:\n${testCase.sourceText}\n\nReturn relationships using only the transcript evidence.`,
		},
	];
}

function validateRelationShape(relation, testCase) {
	if (!isRecord(relation)) throw new Error('relation is not an object');
	for (const field of [
		'head_mention',
		'relation_type',
		'tail_mention',
		'direction',
		'source_message_id',
		'quote',
		'is_explicit',
		'negated',
		'temporal_status',
		'confirmed_eligible',
	]) {
		if (!(field in relation)) throw new Error(`relation missing ${field}`);
	}
	if (!RELATION_TYPES.includes(relation.relation_type)) {
		throw new Error(`invalid relation_type: ${relation.relation_type}`);
	}
	if (!DIRECTIONS.includes(relation.direction)) {
		throw new Error(`invalid direction: ${relation.direction}`);
	}
	if (!TEMPORAL_STATUSES.includes(relation.temporal_status)) {
		throw new Error(`invalid temporal_status: ${relation.temporal_status}`);
	}
	if (!exactQuoteInSource(relation.quote, testCase.sourceText)) {
		throw new Error(`ungrounded relation quote: ${relation.quote}`);
	}
	if (!testCase.allowedSourceIds.has(relation.source_message_id)) {
		throw new Error(`invalid source_message_id: ${relation.source_message_id}`);
	}
	if (relation.char_start !== undefined || relation.char_end !== undefined) {
		if (typeof relation.char_start !== 'number' || typeof relation.char_end !== 'number') {
			throw new Error('relation char offsets must both be numbers when present');
		}
		if (relation.char_start < 0 || relation.char_end <= relation.char_start) {
			throw new Error('relation char offsets are invalid');
		}
	}
}

function validateExpectedRelation(relation, expectation) {
	if (relation.relation_type !== expectation.relationType) {
		throw new Error(`expected ${expectation.relationType}, got ${relation.relation_type}`);
	}
	if (relation.direction !== expectation.direction) {
		throw new Error(`expected ${expectation.direction}, got ${relation.direction}`);
	}
	if (relation.temporal_status !== expectation.temporalStatus) {
		throw new Error(
			`expected temporal_status ${expectation.temporalStatus}, got ${relation.temporal_status}`,
		);
	}
	if (relation.confirmed_eligible !== expectation.confirmedEligible) {
		throw new Error(
			`expected confirmed_eligible ${expectation.confirmedEligible}, got ${relation.confirmed_eligible}`,
		);
	}
	if (relation.negated !== expectation.negated) {
		throw new Error(`expected negated ${expectation.negated}, got ${relation.negated}`);
	}
	if (relation.is_explicit !== expectation.isExplicit) {
		throw new Error(`expected is_explicit ${expectation.isExplicit}, got ${relation.is_explicit}`);
	}
}

export function validateKnowledgeRelationshipOutput(parsed, testCase) {
	const relations = assertArray(parsed.relations, 'relations').map(normalizeRelationOutput);
	if (
		testCase.expectedRelationCount !== undefined &&
		relations.length !== testCase.expectedRelationCount
	) {
		throw new Error(
			`expected ${testCase.expectedRelationCount} relations, got ${relations.length}`,
		);
	}
	if (testCase.minRelationCount !== undefined && relations.length < testCase.minRelationCount) {
		throw new Error(
			`expected at least ${testCase.minRelationCount} relations, got ${relations.length}`,
		);
	}

	for (const relation of relations) validateRelationShape(relation, testCase);

	for (const expectation of testCase.expectedRelations ?? []) {
		const relation = relations.find(
			(candidate) =>
				candidate.relation_type === expectation.relationType &&
				candidate.head_mention === expectation.headMention &&
				candidate.tail_mention === expectation.tailMention,
		);
		if (!relation) {
			throw new Error(
				`missing expected relation ${expectation.headMention} ${expectation.relationType} ${expectation.tailMention}`,
			);
		}
		validateExpectedRelation(relation, expectation);
	}

	if (
		testCase.forbidConfirmedRelations &&
		relations.some((relation) => relation.confirmed_eligible)
	) {
		throw new Error('case forbids confirmed-eligible relations');
	}
}

export function validateKnowledgeRelationshipSafetyOutput(parsed, testCase) {
	const relations = assertArray(parsed.relations, 'relations').map(normalizeRelationOutput);

	for (const relation of relations) {
		if (!isRecord(relation)) throw new Error('relation is not an object');
		if (relation.confirmed_eligible !== true) continue;

		validateRelationShape(relation, testCase);

		if (testCase.forbidConfirmedRelations) {
			throw new Error('case forbids confirmed-eligible relations');
		}
		if (relation.negated) throw new Error('confirmed-eligible relation is negated');
		if (!relation.is_explicit) {
			throw new Error('confirmed-eligible relation is not explicitly stated');
		}
		if (relation.temporal_status !== 'current') {
			throw new Error(
				`confirmed-eligible relation has non-current temporal status: ${relation.temporal_status}`,
			);
		}
	}
}

function sourceIds(ids) {
	return new Set(ids);
}

export const knowledgeRelationshipBenchmarkCases = [
	{
		name: 'knowledge_relationship_explicit_affiliation',
		description: 'Explicit affiliation relation with grounded quote',
		maxTokens: 550,
		temperature: 0,
		nodeMentions: ['Alice', 'Acme'],
		sourceText: '[source:m1] Alice at Acme asked for the migration plan.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		expectedRelationCount: 1,
		expectedRelations: [
			{
				headMention: 'Alice',
				relationType: 'AFFILIATED_WITH',
				tailMention: 'Acme',
				direction: 'head_to_tail',
				temporalStatus: 'current',
				confirmedEligible: true,
				negated: false,
				isExplicit: true,
			},
		],
		validate: validateKnowledgeRelationshipOutput,
	},
	{
		name: 'knowledge_relationship_works_on',
		description: 'Explicit works-on relation with grounded quote',
		maxTokens: 550,
		temperature: 0,
		nodeMentions: ['Ben', 'Solana payment rails rollout'],
		sourceText: '[source:m1] Ben is working on the Solana payment rails rollout.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		expectedRelationCount: 1,
		expectedRelations: [
			{
				headMention: 'Ben',
				relationType: 'WORKS_ON',
				tailMention: 'Solana payment rails rollout',
				direction: 'head_to_tail',
				temporalStatus: 'current',
				confirmedEligible: true,
				negated: false,
				isExplicit: true,
			},
		],
		validate: validateKnowledgeRelationshipOutput,
	},
	{
		name: 'knowledge_relationship_negated',
		description: 'Negated relationship must not be confirmed eligible',
		maxTokens: 550,
		temperature: 0,
		nodeMentions: ['Alice', 'Acme'],
		sourceText: '[source:m1] Alice is not working with Acme anymore.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		minRelationCount: 1,
		forbidConfirmedRelations: true,
		expectedRelations: [
			{
				headMention: 'Alice',
				relationType: 'AFFILIATED_WITH',
				tailMention: 'Acme',
				direction: 'head_to_tail',
				temporalStatus: 'past',
				confirmedEligible: false,
				negated: true,
				isExplicit: true,
			},
		],
		validate: validateKnowledgeRelationshipOutput,
	},
	{
		name: 'knowledge_relationship_past_stale',
		description: 'Past/stale and current tool-use relations must be separated',
		maxTokens: 700,
		temperature: 0,
		nodeMentions: ['we', 'HubSpot', 'Attio'],
		sourceText: '[source:m1] We used to use HubSpot before moving to Attio.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		expectedRelationCount: 2,
		expectedRelations: [
			{
				headMention: 'we',
				relationType: 'USES',
				tailMention: 'HubSpot',
				direction: 'head_to_tail',
				temporalStatus: 'past',
				confirmedEligible: false,
				negated: false,
				isExplicit: true,
			},
			{
				headMention: 'we',
				relationType: 'USES',
				tailMention: 'Attio',
				direction: 'head_to_tail',
				temporalStatus: 'current',
				confirmedEligible: true,
				negated: false,
				isExplicit: true,
			},
		],
		validate: validateKnowledgeRelationshipOutput,
	},
	{
		name: 'knowledge_relationship_co_mention_trap',
		description: 'Co-mentions must not become confirmed graph edges',
		maxTokens: 500,
		temperature: 0,
		nodeMentions: ['Alice', 'Acme', 'Stripe'],
		sourceText: '[source:m1] Alice mentioned Acme and Stripe in the same update.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		expectedRelationCount: 0,
		forbidConfirmedRelations: true,
		validate: validateKnowledgeRelationshipOutput,
	},
	{
		name: 'knowledge_relationship_direction',
		description: 'Directed ownership relation must preserve direction',
		maxTokens: 550,
		temperature: 0,
		nodeMentions: ['Northstar', 'onboarding project'],
		sourceText: '[source:m1] Northstar owns the onboarding project.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		expectedRelationCount: 1,
		expectedRelations: [
			{
				headMention: 'Northstar',
				relationType: 'OWNS_OR_RESPONSIBLE_FOR',
				tailMention: 'onboarding project',
				direction: 'head_to_tail',
				temporalStatus: 'current',
				confirmedEligible: true,
				negated: false,
				isExplicit: true,
			},
		],
		validate: validateKnowledgeRelationshipOutput,
	},
	{
		name: 'knowledge_relationship_unattributed',
		description: 'Unattributed person/contact relation must require review',
		maxTokens: 550,
		temperature: 0,
		nodeMentions: ['Jordan', 'Orbit Labs'],
		sourceText: '[source:m1 unattributed] Jordan works with Orbit Labs.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		expectedRelationCount: 1,
		forbidConfirmedRelations: true,
		expectedRelations: [
			{
				headMention: 'Jordan',
				relationType: 'AFFILIATED_WITH',
				tailMention: 'Orbit Labs',
				direction: 'head_to_tail',
				temporalStatus: 'current',
				confirmedEligible: false,
				negated: false,
				isExplicit: true,
			},
		],
		validate: validateKnowledgeRelationshipOutput,
	},
	{
		name: 'knowledge_relationship_quote_mismatch_guard',
		description: 'Exact quote and char-span validation guard',
		maxTokens: 550,
		temperature: 0,
		nodeMentions: ['Cara', 'security review'],
		sourceText: '[source:m1] Cara requested the security review.',
		allowedSourceIds: sourceIds(['m1']),
		format: relationSchema(),
		messagesFor: relationMessages,
		expectedRelationCount: 1,
		expectedRelations: [
			{
				headMention: 'Cara',
				relationType: 'REQUESTED',
				tailMention: 'security review',
				direction: 'head_to_tail',
				temporalStatus: 'current',
				confirmedEligible: true,
				negated: false,
				isExplicit: true,
			},
		],
		validate: validateKnowledgeRelationshipOutput,
	},
];

for (const testCase of knowledgeRelationshipBenchmarkCases) {
	testCase.validateSafety = validateKnowledgeRelationshipSafetyOutput;
}

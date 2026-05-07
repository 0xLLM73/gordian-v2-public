import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { inferWithCache } from './cached-inference';

/**
 * Relationship Extraction (Phase 13).
 * Uses Claude tool_use to identify relationships between contacts
 * from entity-masked memory content. Input must already be sanitized
 * (contentSanitized from memories table) — NEVER pass raw PII.
 */

const EXTRACT_RELATIONSHIPS_TOOL: Tool = {
	name: 'extract_relationships',
	description: 'Extract relationships between people mentioned in conversations',
	input_schema: {
		type: 'object' as const,
		properties: {
			relationships: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						source_name: { type: 'string' },
						target_name: { type: 'string' },
						relationship_type: {
							type: 'string',
							enum: [
								'professional',
								'personal',
								'investor',
								'advisor',
								'co_investor',
								'introduced_by',
								'founder',
								'colleague',
								'other',
							],
						},
						strength_estimate: { type: 'number', minimum: 0, maximum: 1 },
						reasoning: { type: 'string' },
					},
					required: [
						'source_name',
						'target_name',
						'relationship_type',
						'strength_estimate',
						'reasoning',
					],
				},
			},
		},
		required: ['relationships'],
	},
};

const EXTRACTION_SYSTEM_KERNEL = `You are a relationship extraction engine for a professional CRM.
Analyze conversation summaries and memory snippets to identify relationships between people.

Rules:
- Only extract relationships that are explicitly evidenced in the text
- Entity names are pseudonymized (e.g., PERSON_a1b2) — preserve them exactly as given
- strength_estimate: 0.9 = very strong/frequent, 0.5 = moderate, 0.2 = weak/uncertain
- Relationship types: professional (work context), investor (VC/angel), advisor, co_investor,
  introduced_by (A introduced B), founder (co-founded together), colleague, personal, other
- Call extract_relationships with ALL relationships found, or an empty array if none`;

export interface ExtractedRelationship {
	source_name: string;
	target_name: string;
	relationship_type: string;
	strength_estimate: number;
	reasoning: string;
}

/**
 * Extract relationships from entity-masked memory content.
 *
 * @param maskedContent - Pre-sanitized text (contentSanitized from memories) — no raw PII
 * @returns Array of extracted relationships (may be empty)
 */
export async function extractRelationships(
	maskedContent: string,
): Promise<ExtractedRelationship[]> {
	if (!maskedContent.trim()) return [];

	let response: Awaited<ReturnType<typeof inferWithCache>>;
	try {
		response = await inferWithCache(
			EXTRACTION_SYSTEM_KERNEL,
			'', // No golden library for now
			'',
			[{ role: 'user', content: maskedContent }],
			{
				tools: [EXTRACT_RELATIONSHIPS_TOOL],
				model: 'claude-haiku-4-5-20251001',
				helicone: { feature: 'relationship-extraction' },
				maxTokens: 1024,
				temperature: 0.1, // Low temperature — deterministic extraction
			},
		);
	} catch {
		return [];
	}

	const toolBlock = response.content.find(
		(b) => b.type === 'tool_use' && b.name === 'extract_relationships',
	);
	if (!toolBlock || toolBlock.type !== 'tool_use') return [];

	const input = toolBlock.input as { relationships?: ExtractedRelationship[] };
	return Array.isArray(input.relationships) ? input.relationships : [];
}

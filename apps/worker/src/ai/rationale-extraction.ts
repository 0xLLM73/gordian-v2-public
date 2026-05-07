import type { SealedEnvelope } from '@repo/crypto';
import { maskEntities } from '@repo/crypto';
import {
	createKnowledgeLink,
	createKnowledgeNode,
	findNodeByNameAnyType,
	incrementNodeMentionCount,
	linkContactToKnowledge,
	searchKnowledgeNodes,
} from '@repo/db';
import { generateEmbedding } from './embeddings';
import { inferWithGemini } from './gemini-inference';
import { prefilterEntities } from './prefilter';

// ─── Constants ────────────────────────────────────────────────────────────────

const RATIONALE_DEDUP_THRESHOLD = 0.92;

// ─── System prompt ───────────────────────────────────────────────────────────

const RATIONALE_SYSTEM_PROMPT = `You are extracting the reasoning behind a user's decision from their Telegram messages.

Given a decision event and the surrounding message history, identify:
1. The primary rationales (1-3 reasons) that motivated this decision
2. A supporting evidence quote from the messages for each rationale
3. Any knowledge entities (topics, projects, technologies) that the rationales reference

IMPORTANT rules:
- Be specific: "High FDV relative to traction" is better than "valuation concerns"
- Use short, canonical names for rationale labels (e.g., "weak tokenomics", "strong team pedigree", "market timing")
- Extract the actual reasoning from messages, do not infer or fabricate
- Never include personal names, phone numbers, or Telegram usernames
- If no clear reasoning is evident in the messages, return an empty rationales array`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecisionContext {
	action: string;
	/** Structural label ONLY — NEVER PII (SEC-PROV-009) */
	label: string;
	contactId?: string;
	entityId?: string;
	entityType?: 'deal' | 'introduction' | 'recommendation' | 'commitment' | 'contact';
	workspaceId: string;
	workspaceSalt: Buffer;
	envelope: SealedEnvelope;
}

interface ExtractedRationale {
	label: string;
	displayLabel: string;
	description: string;
	evidenceQuote: string;
	relatedEntities: string[];
	confidence: number;
}

/** Gemini JSON extraction prompt (KG-3) — instructs model to output structured JSON */
const GEMINI_RATIONALE_PROMPT = `${RATIONALE_SYSTEM_PROMPT}

Respond with ONLY a JSON object containing:
- "rationales": array of objects with { label, displayLabel, description, evidenceQuote, relatedEntities: string[], confidence: number }
- "decisionSummary": 1-sentence summary of the decision

Example: {"rationales": [{"label": "weak tokenomics", "displayLabel": "Weak Tokenomics", "description": "High FDV relative to traction", "evidenceQuote": "the FDV is way too high for this stage", "relatedEntities": ["tokenomics"], "confidence": 0.85}], "decisionSummary": "Passed on investment due to valuation concerns"}`;

// ─── Main extraction function ────────────────────────────────────────────────

/**
 * Extract decision rationales from message context using Gemini Flash (KG-3).
 * Writes decision + rationale nodes to the knowledge graph with dedup.
 *
 * Security controls:
 * - SEC-PROV-001: Evidence quotes masked via ELM before DB storage
 * - SEC-PROV-002: All embedding inputs masked before generateEmbedding()
 * - SEC-PROV-009: displayName uses structural format only, never PII
 * - SEC-PROV-015 / SEC-PROV-251: Entity names capped at 100 chars
 */
export async function extractDecisionRationales(
	context: DecisionContext,
	messages: string[],
): Promise<void> {
	if (messages.length === 0) return;

	const { workspaceId, contactId, workspaceSalt, envelope } = context;

	// SEC-PROV-002: Mask messages before LLM call
	const maskedMessages = messages.slice(-50).map((m) => {
		const detected = prefilterEntities(m);
		return maskEntities(m, workspaceSalt, detected).maskedText;
	});

	const userPrompt = `Decision: ${context.action} — "${context.label}"

Recent messages with this contact:

${maskedMessages.join('\n')}

Extract the rationales that motivated this decision.`;

	const responseText = await inferWithGemini({
		systemPrompt: GEMINI_RATIONALE_PROMPT,
		userPrompt,
	});

	let input: { rationales?: ExtractedRationale[]; decisionSummary?: string };
	try {
		const cleaned = responseText.replace(/```json\n?|\n?```/g, '').trim();
		input = JSON.parse(cleaned);
	} catch {
		console.log('[rationale-extraction] Failed to parse Gemini JSON response');
		return;
	}

	if (!Array.isArray(input.rationales) || input.rationales.length === 0) return;

	// Create Decision node
	// SEC-PROV-002: Mask embedding input — LLM decisionSummary may contain residual PII
	// SEC-PROV-009: displayName is structural only
	const rawDecisionInput = `Decision: ${context.action} | ${input.decisionSummary ?? context.label}`;
	const decDetected = prefilterEntities(rawDecisionInput);
	const { maskedText: maskedDecisionInput } = maskEntities(
		rawDecisionInput,
		workspaceSalt,
		decDetected,
	);
	const decisionEmbedding = await generateEmbedding(maskedDecisionInput);

	const structuralDisplayName = `${context.action} — ${context.label}`;

	const decisionNode = await createKnowledgeNode(
		workspaceId,
		{
			type: 'decision',
			name: `${context.action}:${context.entityId ?? Date.now()}`.toLowerCase(),
			displayName: structuralDisplayName,
			description: structuralDisplayName,
			embedding: decisionEmbedding,
			metadata: {
				action: context.action,
				entityId: context.entityId,
				entityType: context.entityType,
				decidedAt: new Date().toISOString(),
			},
		},
		envelope,
	);

	// Link contact to decision
	if (contactId) {
		await linkContactToKnowledge(workspaceId, decisionNode.id, contactId, 'decided');
	}

	// Process rationales (confidence >= 0.7, max 3)
	const rationales = input.rationales.filter((r) => r.confidence >= 0.7).slice(0, 3);

	for (const rationale of rationales) {
		try {
			// SEC-PROV-002: Mask embedding input
			const rawRatInput = `Rationale: ${rationale.displayLabel} | ${rationale.description}`;
			const ratDetected = prefilterEntities(rawRatInput);
			const { maskedText: maskedRatInput } = maskEntities(rawRatInput, workspaceSalt, ratDetected);
			const rationaleEmbedding = await generateEmbedding(maskedRatInput);

			// Dedup against existing rationale nodes
			const candidates = await searchKnowledgeNodes(
				workspaceId,
				rationale.label,
				rationaleEmbedding,
				envelope,
			);
			let rationaleNodeId: string;

			const closest = candidates[0];
			if (closest?.similarity !== undefined && closest.type === 'rationale') {
				const sim = closest.similarity;
				if (sim >= RATIONALE_DEDUP_THRESHOLD) {
					rationaleNodeId = closest.id;
					await incrementNodeMentionCount(workspaceId, rationaleNodeId);
					console.log(
						`[rationale-extraction] Dedup reuse: "${closest.name}" (sim=${sim.toFixed(3)})`,
					);
				} else {
					const node = await createRationaleNode(
						workspaceId,
						rationale,
						rationaleEmbedding,
						workspaceSalt,
						envelope,
					);
					rationaleNodeId = node.id;
				}
			} else {
				const node = await createRationaleNode(
					workspaceId,
					rationale,
					rationaleEmbedding,
					workspaceSalt,
					envelope,
				);
				rationaleNodeId = node.id;
			}

			// Decision --cites--> Rationale
			await createKnowledgeLink(
				workspaceId,
				decisionNode.id,
				rationaleNodeId,
				'cites',
				rationale.confidence,
			);

			// Link rationale to existing knowledge entities
			for (const entityName of rationale.relatedEntities) {
				// SEC-PROV-015 + SEC-PROV-251: Cap entity names at 100 chars
				if (typeof entityName !== 'string' || entityName.length > 100) continue;
				const existingEntity = await findNodeByNameAnyType(
					workspaceId,
					entityName.toLowerCase(),
					envelope,
				);
				if (existingEntity) {
					await createKnowledgeLink(
						workspaceId,
						rationaleNodeId,
						existingEntity.id,
						'related_to',
						0.8,
					);
				}
			}
		} catch (err) {
			console.error(
				`[rationale-extraction] Failed to process rationale "${rationale.label}":`,
				(err as Error).message,
			);
		}
	}

	console.log(
		`[rationale-extraction] Extracted ${rationales.length} rationale(s) for ${context.action}`,
	);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** SEC-PROV-001: Evidence quotes masked via ELM before DB storage. */
async function createRationaleNode(
	workspaceId: string,
	rationale: ExtractedRationale,
	embedding: number[],
	workspaceSalt: Buffer,
	envelope: SealedEnvelope,
) {
	return createKnowledgeNode(
		workspaceId,
		{
			type: 'rationale',
			name: rationale.label.toLowerCase(),
			displayName: rationale.displayLabel,
			description: rationale.description,
			embedding,
			metadata: {
				evidenceQuote: maskEntities(
					rationale.evidenceQuote,
					workspaceSalt,
					prefilterEntities(rationale.evidenceQuote),
				).maskedText,
			},
		},
		envelope,
	);
}

import { createHmac } from 'node:crypto';
import type { DetectedEntity, EntityMap, EntityType, MaskResult } from './types';

/**
 * Entity-Linked Masking (followup12a/12b):
 * Replace PII with consistent, workspace-scoped pseudonyms.
 * "Alice called Bob" → "PERSON_a1b2 called PERSON_c3d4"
 *
 * CRITICAL: Embeddings are invertible. Vec2Text recovers 92% of text.
 * Raw PII must NEVER be embedded. This function sanitizes text before
 * it reaches the embedding API.
 */

/**
 * Generate a consistent pseudonym for an entity using HMAC.
 * Same entity + same salt → same pseudonym (enables entity co-reference).
 */
function generatePseudonym(entityText: string, type: string, salt: Buffer): string {
	const hash = createHmac('sha256', salt)
		.update(entityText.toLowerCase().trim())
		.digest('hex')
		.substring(0, 8); // NOTE: Pseudonym length changed from 4→8 hex in Sprint 6 (SEC-037).
	// Existing embeddings have 4-char pseudonyms and will naturally refresh on next sync.
	// Full re-embedding deferred to multi-user launch.

	return `${type}_${hash}`;
}

/**
 * Mask detected entities in text with consistent pseudonyms.
 *
 * @param text - Raw text containing PII
 * @param workspaceSalt - Workspace-scoped salt for consistent pseudonyms
 * @param detectedEntities - Entities detected by NER or heuristic prefilter
 * @returns Masked text and entity map for reverse lookup
 */
export function maskEntities(
	text: string,
	workspaceSalt: Buffer,
	detectedEntities: DetectedEntity[],
): MaskResult {
	if (detectedEntities.length === 0) {
		return { maskedText: text, entityMap: [] };
	}

	const entityMap: EntityMap[] = [];
	let maskedText = text;

	// Sort by position (descending) to preserve offsets during replacement
	const sorted = [...detectedEntities].sort((a, b) => b.start - a.start);

	for (const entity of sorted) {
		const pseudonym = generatePseudonym(entity.text, entity.type, workspaceSalt);

		entityMap.push({
			original: entity.text,
			pseudonym,
			type: entity.type,
		});

		maskedText =
			maskedText.substring(0, entity.start) + pseudonym + maskedText.substring(entity.end);
	}

	return { maskedText, entityMap };
}

// ─── Heuristic Prefilter ──────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ type: EntityType; pattern: RegExp }> = [
	{ type: 'EMAIL', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
	{
		type: 'PHONE',
		pattern: /(?:\+\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
	},
	{
		type: 'MONEY',
		pattern:
			/[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|ETH|BTC|USDT|USDC)\b/gi,
	},
];

const MIN_PHONE_LENGTH = 7;

/**
 * Detect structured PII entities using regex patterns.
 * Returns entities sorted by start position (ascending), deduplicated by span.
 */
export function prefilterEntities(text: string): DetectedEntity[] {
	const entities: DetectedEntity[] = [];

	for (const { type, pattern } of PII_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match = regex.exec(text);
		while (match !== null) {
			const matchText = match[0];
			const start = match.index;
			const end = start + matchText.length;

			if (type !== 'PHONE' || matchText.replace(/\D/g, '').length >= MIN_PHONE_LENGTH) {
				entities.push({ text: matchText, type, start, end });
			}
			match = regex.exec(text);
		}
	}

	entities.sort((a, b) => a.start - b.start || b.end - a.end);

	const deduped: DetectedEntity[] = [];
	let lastEnd = -1;
	for (const entity of entities) {
		if (entity.start >= lastEnd) {
			deduped.push(entity);
			lastEnd = entity.end;
		}
	}

	return deduped;
}

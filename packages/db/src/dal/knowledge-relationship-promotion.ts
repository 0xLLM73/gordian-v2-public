export type KnowledgeLinkType =
	| 'affiliated_with'
	| 'alternative_to'
	| 'works_on'
	| 'owns_or_responsible_for'
	| 'interested_in'
	| 'requested'
	| 'part_of'
	| 'depends_on'
	| 'related_to'
	| 'competes_with'
	| 'builds_on'
	| 'funds'
	| 'uses'
	| 'cites'
	| 'led_to'
	| 'preceded_by'
	| 'contradicts';

export type KnowledgeRelationshipPromotionStatus =
	| 'review_only'
	| 'eligible'
	| 'promoted'
	| 'rejected';

export type KnowledgeRelationshipPromotionEvidenceKind =
	| 'llm_extracted'
	| 'embedding_match'
	| 'contact_cooccurrence'
	| 'manual'
	| 'inferred_weak';

export interface KnowledgeRelationshipPromotionCandidateInput {
	sourceNodeId: string;
	targetNodeId: string;
	linkType: KnowledgeLinkType;
	evidenceKind: KnowledgeRelationshipPromotionEvidenceKind;
	confidence?: number | null;
	sourceEvidenceId?: string | null;
	messageId?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface KnowledgeRelationshipPromotionAssessment {
	canPromote: boolean;
	status: KnowledgeRelationshipPromotionStatus;
	reason: string;
}

function metadataBoolean(
	metadata: Record<string, unknown> | null | undefined,
	keys: string[],
): boolean {
	if (!metadata) return false;
	return keys.some((key) => metadata[key] === true);
}

function metadataString(
	metadata: Record<string, unknown> | null | undefined,
	keys: string[],
): string | null {
	if (!metadata) return null;
	for (const key of keys) {
		const value = metadata[key];
		if (typeof value === 'string' && value.trim().length > 0) return value.trim().toLowerCase();
	}
	return null;
}

export function assessKnowledgeRelationshipCandidateForPromotion(
	data: KnowledgeRelationshipPromotionCandidateInput,
): KnowledgeRelationshipPromotionAssessment {
	if (data.sourceNodeId === data.targetNodeId) {
		return {
			canPromote: false,
			status: 'rejected',
			reason: 'self-referential relationship candidates cannot be promoted',
		};
	}

	if (data.evidenceKind === 'embedding_match' || data.evidenceKind === 'contact_cooccurrence') {
		return {
			canPromote: false,
			status: 'review_only',
			reason: `${data.evidenceKind} is a heuristic signal and needs direct quoted evidence before graph promotion`,
		};
	}

	if (data.evidenceKind === 'inferred_weak') {
		return {
			canPromote: false,
			status: 'review_only',
			reason: 'weak inferred relationships are review-only until confirmed by direct evidence',
		};
	}

	const metadata = data.metadata ?? {};
	if (data.evidenceKind === 'manual') {
		if (
			data.sourceEvidenceId ||
			metadataBoolean(metadata, ['manualReviewApproved', 'manual_review_approved'])
		) {
			return {
				canPromote: true,
				status: 'eligible',
				reason: 'manual relationship has review-approved evidence',
			};
		}

		return {
			canPromote: false,
			status: 'review_only',
			reason: 'manual relationships need review approval or a stored evidence row before promotion',
		};
	}

	if (data.evidenceKind === 'llm_extracted') {
		if (metadataBoolean(metadata, ['negated'])) {
			return {
				canPromote: false,
				status: 'rejected',
				reason: 'negated relationships cannot be promoted',
			};
		}

		const temporalStatus = metadataString(metadata, ['temporalStatus', 'temporal_status']);
		if (temporalStatus !== 'current') {
			return {
				canPromote: false,
				status: 'review_only',
				reason: temporalStatus
					? `temporal status ${temporalStatus} requires human review before promotion`
					: 'LLM relationships need current temporal status before promotion',
			};
		}

		if (!data.sourceEvidenceId && !data.messageId) {
			return {
				canPromote: false,
				status: 'review_only',
				reason: 'LLM relationships need a source message or stored evidence row before promotion',
			};
		}

		if (!metadataBoolean(metadata, ['confirmedEligible', 'confirmed_eligible'])) {
			return {
				canPromote: false,
				status: 'review_only',
				reason: 'LLM relationship was not marked confirmed eligible',
			};
		}

		if (!metadataBoolean(metadata, ['isExplicit', 'is_explicit'])) {
			return {
				canPromote: false,
				status: 'review_only',
				reason: 'LLM relationship is not explicitly stated in the source text',
			};
		}

		if (!metadataBoolean(metadata, ['quoteVerified', 'quote_verified'])) {
			return {
				canPromote: false,
				status: 'review_only',
				reason: 'LLM relationship quote has not been verified against the source text',
			};
		}

		return {
			canPromote: true,
			status: 'eligible',
			reason: 'direct quote-backed LLM relationship is eligible for graph promotion',
		};
	}

	return {
		canPromote: false,
		status: 'review_only',
		reason: 'unsupported relationship evidence kind',
	};
}

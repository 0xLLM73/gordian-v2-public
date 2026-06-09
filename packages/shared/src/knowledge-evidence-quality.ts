export type KnowledgeEvidenceQuality = 'direct_source' | 'possible_connection' | 'weak_or_stale';

export interface KnowledgeEvidenceQualityInput {
	evidenceKind?: string | null;
	messageId?: string | null;
	snippet?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface KnowledgeEvidenceQualityResult {
	quality: KnowledgeEvidenceQuality;
	reason: string;
}

export function normalizeKnowledgeEvidenceTerm(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function sourceMessageSelectionMethod(
	evidence: Pick<KnowledgeEvidenceQualityInput, 'metadata'>,
): string | null {
	const selection = evidence.metadata?.sourceMessageSelection;
	if (!selection || typeof selection !== 'object') return null;
	const method = (selection as { method?: unknown }).method;
	return typeof method === 'string' ? method : null;
}

export function evidenceMatchesTopicTerms(
	evidence: Pick<KnowledgeEvidenceQualityInput, 'snippet' | 'metadata'>,
	topicTerms: string[] = [],
): boolean {
	if (topicTerms.length === 0) return false;
	if (!evidence.snippet) return false;

	const normalizedSnippet = normalizeKnowledgeEvidenceTerm(evidence.snippet);
	return topicTerms.some((term) => {
		const normalizedTerm = normalizeKnowledgeEvidenceTerm(term);
		return normalizedTerm.length >= 3 && normalizedSnippet.includes(normalizedTerm);
	});
}

export function classifyKnowledgeEvidenceQuality(
	evidence: KnowledgeEvidenceQualityInput,
	topicTerms: string[] = [],
): KnowledgeEvidenceQualityResult {
	const method = sourceMessageSelectionMethod(evidence);
	if (method === 'fallback_latest') {
		return { quality: 'weak_or_stale', reason: 'fallback latest message' };
	}
	if (!evidence.messageId && evidence.evidenceKind === 'manual') {
		return { quality: 'possible_connection', reason: 'manual evidence without source message' };
	}
	if (!evidence.messageId) {
		return { quality: 'weak_or_stale', reason: 'no source message' };
	}
	if (!evidence.snippet) {
		return { quality: 'possible_connection', reason: 'source message without snippet' };
	}
	if (evidenceMatchesTopicTerms(evidence, topicTerms)) {
		return { quality: 'direct_source', reason: 'matched topic text' };
	}
	if (evidence.evidenceKind === 'manual') {
		return { quality: 'possible_connection', reason: 'manual evidence without topic text' };
	}
	if (evidence.evidenceKind === 'inferred_weak') {
		return { quality: 'weak_or_stale', reason: 'weak inferred evidence' };
	}
	return { quality: 'possible_connection', reason: 'source message without topic match' };
}

export function evidenceSupportsKnowledgeTopic(
	evidence: KnowledgeEvidenceQualityInput,
	topicTerms: string[] = [],
): boolean {
	return classifyKnowledgeEvidenceQuality(evidence, topicTerms).quality === 'direct_source';
}

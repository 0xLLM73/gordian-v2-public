import { describe, expect, it } from 'vitest';
import {
	classifyKnowledgeEvidenceQuality,
	evidenceSupportsKnowledgeTopic,
	sourceMessageSelectionMethod,
} from '../knowledge-evidence-quality';

describe('knowledge evidence quality', () => {
	it('classifies source snippets that mention the topic as direct evidence', () => {
		const evidence = {
			messageId: 'message-1',
			evidenceKind: 'llm_extracted',
			snippet: "We are using DSPy's eval tooling.",
			metadata: { sourceMessageSelection: { method: 'exact_normalized_name' } },
		};

		expect(classifyKnowledgeEvidenceQuality(evidence, ['DSPy'])).toEqual({
			quality: 'direct_source',
			reason: 'matched topic text',
		});
		expect(evidenceSupportsKnowledgeTopic(evidence, ['DSPy'])).toBe(true);
	});

	it('keeps source-backed snippets without topic text as possible connections', () => {
		expect(
			classifyKnowledgeEvidenceQuality(
				{
					messageId: 'message-2',
					evidenceKind: 'llm_extracted',
					snippet: 'We should apply for the Solana demo day.',
					metadata: { sourceMessageSelection: { method: 'exact_normalized_name' } },
				},
				['DSPy'],
			),
		).toEqual({
			quality: 'possible_connection',
			reason: 'source message without topic match',
		});
	});

	it('demotes fallback-selected evidence as weak or stale', () => {
		const evidence = {
			messageId: 'message-3',
			evidenceKind: 'llm_extracted',
			snippet: 'DSPy is mentioned here.',
			metadata: { sourceMessageSelection: { method: 'fallback_latest' } },
		};

		expect(sourceMessageSelectionMethod(evidence)).toBe('fallback_latest');
		expect(classifyKnowledgeEvidenceQuality(evidence, ['DSPy'])).toEqual({
			quality: 'weak_or_stale',
			reason: 'fallback latest message',
		});
		expect(evidenceSupportsKnowledgeTopic(evidence, ['DSPy'])).toBe(false);
	});
});

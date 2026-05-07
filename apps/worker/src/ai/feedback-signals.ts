import { createCorrectionDiff, createGoldenExample } from '@repo/db';
import { recordOutcome } from './bandit';
import type { ExtractedCommitment } from './commitment-extraction';

/**
 * Automatic feedback signals from the extraction pipeline.
 *
 * Closes the learning loop by:
 * 1. Rewarding the bandit with precision ratio (verified / candidates)
 * 2. Creating pending golden examples from verified commitments
 * 3. Creating correction diffs for false positives (Pass 1 candidates discarded in Pass 2)
 */

interface ExtractionFeedbackInput {
	/** Pass 1 candidates (wide net) */
	candidates: ExtractedCommitment[];
	/** Pass 2 verified commitments */
	verified: ExtractedCommitment[];
	/** Conversation transcript used for extraction */
	transcript: string;
	/** Bandit trace ID for reward finalization */
	traceId: string;
	/** Bandit variant that was selected */
	variant: string;
	/** Workspace ID for tenant-scoped golden examples (SEC-004) */
	workspaceId: string;
}

export async function recordExtractionFeedback(input: ExtractionFeedbackInput): Promise<void> {
	const { candidates, verified, transcript, traceId, variant, workspaceId } = input;

	// 1. Bandit reward: precision ratio (how many candidates survived Pass 2)
	const rewardScore = candidates.length > 0 ? verified.length / candidates.length : 0;
	await recordOutcome(traceId, rewardScore);

	// 2. Golden examples: create pending examples from verified commitments
	// SEC-001: transcript is already masked by the caller (ai-flow.ts) via ELM
	for (const commitment of verified) {
		await createGoldenExample({
			workspaceId,
			featureDomain: 'commitment_extraction',
			inputContext: transcript.slice(0, 2000),
			modelPrediction: commitment,
			correctedOutput: commitment, // Verified by Pass 2 = treated as correct
			// SEC-002: Only structural metadata in reasoning — no PII
			correctionReasoning: `Auto-verified by Pass 2 filter (confidence=${commitment.confidence}, variant=${variant})`,
			source: 'implicit_signal',
			difficulty: 'standard',
		});
	}

	// 3. Correction diffs: false positives (in Pass 1 but rejected by Pass 2)
	const verifiedTitles = new Set(verified.map((v) => v.title));
	const falsePositives = candidates.filter((c) => !verifiedTitles.has(c.title));

	for (const fp of falsePositives) {
		// We need a golden example to attach the diff to — create a rejected-signal example
		const example = await createGoldenExample({
			workspaceId,
			featureDomain: 'commitment_extraction',
			inputContext: transcript.slice(0, 2000),
			modelPrediction: fp,
			correctedOutput: null, // Pass 2 rejected it
			// SEC-002: Only structural metadata — no raw titles or quotes
			correctionReasoning: `False positive: Pass 1 candidate rejected by Pass 2 (type=${fp.commitment_type}, confidence=${fp.confidence}, variant=${variant})`,
			source: 'implicit_signal',
			difficulty: 'standard',
		});

		if (example) {
			// SEC-002: Description uses only structural data — no PII (titles, quotes)
			await createCorrectionDiff({
				workspaceId,
				goldenId: example.id,
				diffType: 'false_positive',
				severityScore: 3,
				description: `False positive: type=${fp.commitment_type}, confidence=${fp.confidence}, assignee=${fp.assignee}, variant=${variant}`,
			});
		}
	}

	console.log(
		`[feedback-signals] traceId=${traceId} reward=${rewardScore.toFixed(2)} golden=${verified.length} diffs=${falsePositives.length}`,
	);
}

/**
 * Dynamic confidence thresholds based on user's commitmentSensitivity (Coffee Test).
 *
 * - extraction: minimum confidence to keep a candidate after Haiku extraction
 * - storage: minimum confidence to store in DB (skip below this in ai-flow worker)
 *
 * everything  → aggressive: low bars, catch casual promises
 * specific    → default: balanced (existing behavior)
 * tasks_only  → strict: high bars, only explicit action items
 */

export type CommitmentSensitivity = 'everything' | 'specific' | 'tasks_only';

interface ConfidenceThresholds {
	extraction: number;
	storage: number;
}

const THRESHOLDS: Record<CommitmentSensitivity, ConfidenceThresholds> = {
	everything: { extraction: 0.3, storage: 0.3 },
	specific: { extraction: 0.4, storage: 0.5 },
	tasks_only: { extraction: 0.55, storage: 0.65 },
};

const DEFAULT_THRESHOLDS: ConfidenceThresholds = THRESHOLDS.specific;

export function getConfidenceThresholds(
	sensitivity?: CommitmentSensitivity | null,
): ConfidenceThresholds {
	if (!sensitivity) return DEFAULT_THRESHOLDS;
	return THRESHOLDS[sensitivity] ?? DEFAULT_THRESHOLDS;
}

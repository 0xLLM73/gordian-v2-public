import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedCommitment } from '../commitment-extraction';

const mockRecordOutcome = vi.fn();
const mockCreateGoldenExample = vi.fn();
const mockCreateCorrectionDiff = vi.fn();

vi.mock('../bandit', () => ({
	recordOutcome: (...args: unknown[]) => mockRecordOutcome(...args),
}));

vi.mock('@repo/db', () => ({
	createGoldenExample: (...args: unknown[]) => mockCreateGoldenExample(...args),
	createCorrectionDiff: (...args: unknown[]) => mockCreateCorrectionDiff(...args),
}));

function makeCommitment(overrides: Partial<ExtractedCommitment> = {}): ExtractedCommitment {
	return {
		title: 'Send report to Alice',
		commitment_type: 'task',
		assignee: 'user',
		confidence: 0.85,
		quote: "I'll send the report",
		...overrides,
	};
}

describe('recordExtractionFeedback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateGoldenExample.mockResolvedValue({ id: 'golden-1' });
	});

	it('computes precision reward: verified / candidates', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		await recordExtractionFeedback({
			candidates: [
				makeCommitment(),
				makeCommitment({ title: 'Call Bob' }),
				makeCommitment({ title: 'Pay invoice' }),
			],
			verified: [makeCommitment()],
			transcript: 'some transcript',
			traceId: 'trace-1',
			variant: 'extraction_default',
			workspaceId: 'ws-1',
		});

		expect(mockRecordOutcome).toHaveBeenCalledWith('trace-1', 1 / 3);
	});

	it('reward is 0 when no candidates', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		await recordExtractionFeedback({
			candidates: [],
			verified: [],
			transcript: 'transcript',
			traceId: 'trace-2',
			variant: 'extraction_strict',
			workspaceId: 'ws-1',
		});

		expect(mockRecordOutcome).toHaveBeenCalledWith('trace-2', 0);
	});

	it('reward is 1.0 when all candidates verified', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		const c1 = makeCommitment({ title: 'A' });
		const c2 = makeCommitment({ title: 'B' });

		await recordExtractionFeedback({
			candidates: [c1, c2],
			verified: [c1, c2],
			transcript: 'transcript',
			traceId: 'trace-3',
			variant: 'extraction_lenient',
			workspaceId: 'ws-1',
		});

		expect(mockRecordOutcome).toHaveBeenCalledWith('trace-3', 1.0);
	});

	it('creates golden examples for each verified commitment', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		const v1 = makeCommitment({ title: 'A', confidence: 0.9 });
		const v2 = makeCommitment({ title: 'B', confidence: 0.7 });

		await recordExtractionFeedback({
			candidates: [v1, v2],
			verified: [v1, v2],
			transcript: 'the transcript',
			traceId: 'trace-4',
			variant: 'extraction_default',
			workspaceId: 'ws-1',
		});

		expect(mockCreateGoldenExample).toHaveBeenCalledTimes(2);
		expect(mockCreateGoldenExample).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				featureDomain: 'commitment_extraction',
				source: 'implicit_signal',
				modelPrediction: v1,
				correctedOutput: v1,
			}),
		);
	});

	it('truncates transcript to 2000 chars in golden examples', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		const longTranscript = 'x'.repeat(5000);

		await recordExtractionFeedback({
			candidates: [makeCommitment()],
			verified: [makeCommitment()],
			transcript: longTranscript,
			traceId: 'trace-5',
			variant: 'extraction_default',
			workspaceId: 'ws-1',
		});

		const call = mockCreateGoldenExample.mock.calls[0][0];
		expect(call.inputContext).toHaveLength(2000);
	});

	it('creates correction diffs for false positives (candidate below confidence threshold)', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		const kept = makeCommitment({ title: 'Real commitment' });
		const rejected = makeCommitment({
			title: 'Social pleasantry',
			commitment_type: 'meeting',
			confidence: 0.45,
			quote: "Let's catch up",
		});

		await recordExtractionFeedback({
			candidates: [kept, rejected],
			verified: [kept],
			transcript: 'transcript',
			traceId: 'trace-6',
			variant: 'extraction_default',
			workspaceId: 'ws-1',
		});

		// 1 golden for the verified + 1 golden for the false positive's parent
		expect(mockCreateGoldenExample).toHaveBeenCalledTimes(2);
		expect(mockCreateGoldenExample).toHaveBeenLastCalledWith(
			expect.objectContaining({
				correctedOutput: { no_commitment: true },
			}),
		);

		// 1 correction diff for the false positive
		expect(mockCreateCorrectionDiff).toHaveBeenCalledTimes(1);
		expect(mockCreateCorrectionDiff).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				goldenId: 'golden-1',
				diffType: 'false_positive',
				severityScore: 3,
			}),
		);
	});

	it('skips correction diff if golden example creation returns null', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		mockCreateGoldenExample.mockResolvedValue(null);

		await recordExtractionFeedback({
			candidates: [makeCommitment({ title: 'Rejected' })],
			verified: [],
			transcript: 'transcript',
			traceId: 'trace-7',
			variant: 'extraction_default',
			workspaceId: 'ws-1',
		});

		expect(mockCreateCorrectionDiff).not.toHaveBeenCalled();
	});

	it('no diffs when all candidates are verified', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		const c = makeCommitment();

		await recordExtractionFeedback({
			candidates: [c],
			verified: [c],
			transcript: 'transcript',
			traceId: 'trace-8',
			variant: 'extraction_default',
			workspaceId: 'ws-1',
		});

		expect(mockCreateCorrectionDiff).not.toHaveBeenCalled();
	});

	it('diff description contains only structural metadata (no PII)', async () => {
		const { recordExtractionFeedback } = await import('../feedback-signals');

		const fp = makeCommitment({
			title: 'Maybe lunch',
			commitment_type: 'meeting',
			confidence: 0.5,
			quote: 'we should do lunch',
		});

		await recordExtractionFeedback({
			candidates: [fp],
			verified: [],
			transcript: 'transcript',
			traceId: 'trace-9',
			variant: 'extraction_strict',
			workspaceId: 'ws-1',
		});

		const diffCall = mockCreateCorrectionDiff.mock.calls[0][0];
		// SEC-002: Description must NOT contain raw titles or quotes (PII)
		expect(diffCall.description).not.toContain('Maybe lunch');
		expect(diffCall.description).not.toContain('we should do lunch');
		// Should contain only structural metadata
		expect(diffCall.description).toContain('meeting');
		expect(diffCall.description).toContain('0.5');
		expect(diffCall.description).toContain('extraction_strict');
	});
});

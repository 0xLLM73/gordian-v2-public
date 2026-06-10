import { describe, expect, it } from 'vitest';
import {
	countBlockedFollowUpPlanSteps,
	getFollowUpPlanAttentionSummary,
	getFollowUpPlanStepAttention,
} from './follow-up-plan-step-attention';

const NOW = new Date('2026-06-09T12:00:00Z');

describe('follow-up plan step attention', () => {
	it('prioritizes pending review drafts as local and unsent', () => {
		const result = getFollowUpPlanStepAttention(
			{ status: 'pending_review', draftText: 'Draft text' },
			NOW,
		);

		expect(result).toEqual(
			expect.objectContaining({
				status: 'needs_review',
				label: 'Draft ready for review',
				detail: 'Local draft waiting. Not sent.',
			}),
		);
	});

	it('surfaces local AI failures as retryable blocked work', () => {
		const result = getFollowUpPlanStepAttention(
			{
				status: 'ready',
				lastProcessingError: 'local AI unavailable',
				processingLeaseExpiresAt: '2026-06-09T11:59:00Z',
			},
			NOW,
		);

		expect(result.status).toBe('blocked');
		expect(result.label).toBe('Local AI blocked');
		expect(result.detail).toContain('local AI unavailable');
		expect(result.detail).toContain('Retryable when the local worker runs.');
	});

	it('redacts database-shaped worker errors before rendering them', () => {
		const result = getFollowUpPlanStepAttention(
			{
				status: 'ready',
				lastProcessingError: 'failed query: select * from "cadence_steps" params: secret',
			},
			NOW,
		);

		expect(result.status).toBe('blocked');
		expect(result.detail).toContain('Worker database query failed.');
		expect(result.detail).not.toContain('secret');
	});

	it('distinguishes active worker leases from overdue ready steps', () => {
		const generating = getFollowUpPlanStepAttention(
			{
				status: 'ready',
				scheduledAt: '2026-06-09T10:00:00Z',
				processingLeaseExpiresAt: '2026-06-09T12:30:00Z',
			},
			NOW,
		);
		const overdue = getFollowUpPlanStepAttention(
			{ status: 'ready', scheduledAt: '2026-06-09T10:00:00Z' },
			NOW,
		);

		expect(generating.status).toBe('generating');
		expect(overdue.status).toBe('overdue');
	});

	it('uses the highest-priority plan attention summary', () => {
		const summary = getFollowUpPlanAttentionSummary(
			[
				{ status: 'ready', scheduledAt: '2026-06-09T10:00:00Z' },
				{ status: 'ready', lastProcessingError: 'local AI unavailable' },
				{ status: 'pending_review', draftText: 'Review me first' },
			],
			NOW,
		);

		expect(summary.status).toBe('needs_review');
	});

	it('counts blocked steps from processing errors', () => {
		expect(
			countBlockedFollowUpPlanSteps([
				{ status: 'ready', lastProcessingError: 'local AI unavailable' },
				{ status: 'ready', lastProcessingError: '' },
				{ status: 'pending_review', draftText: 'Draft' },
			]),
		).toBe(1);
	});
});

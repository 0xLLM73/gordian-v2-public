import { describe, expect, it } from 'vitest';
import {
	followUpPlanMatchesFilters,
	hasFollowUpPlanListFilters,
	parseFollowUpPlanListFilters,
} from './follow-up-plan-list-filters';

describe('follow-up plan list filters', () => {
	it('parses safe URL filters and ignores invalid values', () => {
		expect(
			parseFollowUpPlanListFilters({
				status: 'active',
				attention: 'needs_review',
				templateId: 'vc-followup',
			}),
		).toEqual({
			status: 'active',
			attention: 'needs_review',
			templateId: 'vc-followup',
		});

		expect(
			parseFollowUpPlanListFilters({
				status: 'sent',
				attention: 'blocked',
				templateId: '   ',
			}),
		).toEqual({
			status: undefined,
			attention: undefined,
			templateId: undefined,
		});
	});

	it('detects when a filter is active', () => {
		expect(hasFollowUpPlanListFilters({})).toBe(false);
		expect(hasFollowUpPlanListFilters({ status: 'paused' })).toBe(true);
	});

	it('matches pending review plans without implying the draft was sent', () => {
		const plan = { status: 'active', templateId: 'vc-followup' };
		const steps = [{ status: 'pending_review', draftText: 'Local draft only' }];

		expect(
			followUpPlanMatchesFilters(
				plan,
				steps,
				{ attention: 'needs_review' },
				new Date('2026-06-09T12:00:00Z'),
			),
		).toBe(true);
	});

	it('matches overdue ready steps by scheduled time', () => {
		const plan = { status: 'active', templateId: 'vc-followup' };
		const now = new Date('2026-06-09T12:00:00Z');

		expect(
			followUpPlanMatchesFilters(
				plan,
				[{ status: 'ready', scheduledAt: '2026-06-09T11:00:00Z' }],
				{ attention: 'overdue' },
				now,
			),
		).toBe(true);
		expect(
			followUpPlanMatchesFilters(
				plan,
				[{ status: 'ready', scheduledAt: '2026-06-09T13:00:00Z' }],
				{ attention: 'overdue' },
				now,
			),
		).toBe(false);
	});
});

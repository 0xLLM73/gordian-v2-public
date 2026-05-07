import { describe, expect, it } from 'vitest';

/**
 * Barrel export verification — ensures all Sprint 10-13 DAL exports
 * are re-exported from the @repo/db barrel (packages/db/src/index.ts).
 * This is the most effective regression test for Bug 1 (missing re-exports).
 */
describe('barrel exports', () => {
	it('exports all token DAL functions', async () => {
		const db = await import('../index');
		expect(typeof db.createTokenMention).toBe('function');
		expect(typeof db.getTopMentionedTokens).toBe('function');
		expect(typeof db.getTokenMentionsByContact).toBe('function');
		expect(typeof db.addToWatchlist).toBe('function');
		expect(typeof db.getWatchlist).toBe('function');
		expect(typeof db.updateWatchlistPrice).toBe('function');
		expect(typeof db.removeFromWatchlist).toBe('function');
		expect(typeof db.incrementMentionCount).toBe('function');
	});

	it('exports all follow-up plan DAL functions and templates', async () => {
		const db = await import('../index');
		expect(typeof db.createFollowUpPlan).toBe('function');
		expect(typeof db.activateFollowUpPlan).toBe('function');
		expect(typeof db.pauseFollowUpPlan).toBe('function');
		expect(typeof db.resumeFollowUpPlan).toBe('function');
		expect(typeof db.cancelFollowUpPlan).toBe('function');
		expect(typeof db.getReadySteps).toBe('function');
		expect(typeof db.advanceStep).toBe('function');
		expect(typeof db.skipStep).toBe('function');
		expect(typeof db.listFollowUpPlans).toBe('function');
		expect(typeof db.getFollowUpPlan).toBe('function');
		expect(typeof db.getFollowUpPlanSteps).toBe('function');
		expect(typeof db.autoPauseOnReply).toBe('function');
		expect(Array.isArray(db.FOLLOW_UP_PLAN_TEMPLATES)).toBe(true);
	});

	it('exports all deal extension DAL functions', async () => {
		const db = await import('../index');
		expect(typeof db.addDealParticipant).toBe('function');
		expect(typeof db.listDealParticipants).toBe('function');
		expect(typeof db.removeDealParticipant).toBe('function');
		expect(typeof db.addDealArtifact).toBe('function');
		expect(typeof db.listDealArtifacts).toBe('function');
		expect(typeof db.removeDealArtifact).toBe('function');
	});

	it('exports all calendar DAL functions', async () => {
		const db = await import('../index');
		expect(typeof db.createCalendarConnection).toBe('function');
		expect(typeof db.getCalendarConnection).toBe('function');
		expect(typeof db.updateCalendarTokens).toBe('function');
		expect(typeof db.updateCalendarLastSync).toBe('function');
		expect(typeof db.deleteCalendarConnection).toBe('function');
		expect(typeof db.upsertCalendarEvent).toBe('function');
		expect(typeof db.matchAttendeeToContact).toBe('function');
		expect(typeof db.listCalendarEvents).toBe('function');
		expect(typeof db.getUpcomingEvents).toBe('function');
		expect(typeof db.getEventCountByContact).toBe('function');
	});
});

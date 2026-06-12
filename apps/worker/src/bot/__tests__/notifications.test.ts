import { describe, expect, it } from 'vitest';
import {
	canSendNotification,
	createDefaultBudget,
	type NotificationBudget,
	recordMuteEvent,
	recordNotificationEngaged,
	recordNotificationIgnored,
	recordNotificationSent,
} from '../features/notifications';

describe('notification budget', () => {
	it('canSendNotification returns true for fresh budget', () => {
		const budget = createDefaultBudget();
		expect(canSendNotification(budget)).toBe(true);
	});

	it('canSendNotification returns false when daily limit reached', () => {
		const budget: NotificationBudget = {
			...createDefaultBudget(),
			dailyCount: 3,
			dailyLimit: 3,
		};
		expect(canSendNotification(budget)).toBe(false);
	});

	it('canSendNotification returns false when weekly limit reached', () => {
		const budget: NotificationBudget = {
			...createDefaultBudget(),
			weeklyCount: 12,
			weeklyLimit: 12,
		};
		expect(canSendNotification(budget)).toBe(false);
	});

	it('recordNotificationIgnored increments consecutiveIgnores', () => {
		const budget = createDefaultBudget();
		const updated = recordNotificationIgnored(budget);
		expect(updated.consecutiveIgnores).toBe(1);
	});

	it('3 consecutive ignores drops dailyLimit to 1', () => {
		let budget = createDefaultBudget();
		budget = recordNotificationIgnored(budget);
		budget = recordNotificationIgnored(budget);
		budget = recordNotificationIgnored(budget);
		expect(budget.dailyLimit).toBe(1);
		expect(budget.consecutiveIgnores).toBe(3);
	});

	it('recordNotificationEngaged resets ignores and restores limit', () => {
		let budget = createDefaultBudget();
		// Throttle down first
		budget = recordNotificationIgnored(budget);
		budget = recordNotificationIgnored(budget);
		budget = recordNotificationIgnored(budget);
		expect(budget.dailyLimit).toBe(1);
		// Engage resets
		budget = recordNotificationEngaged(budget);
		expect(budget.consecutiveIgnores).toBe(0);
		expect(budget.dailyLimit).toBe(3);
	});

	it('recordMuteEvent sets consecutiveIgnores to 3 and dailyLimit to 1', () => {
		const budget = createDefaultBudget();
		const muted = recordMuteEvent(budget);
		expect(muted.consecutiveIgnores).toBe(3);
		expect(muted.dailyLimit).toBe(1);
	});

	it('budget resets dailyCount on a new day', () => {
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		const budget: NotificationBudget = {
			...createDefaultBudget(),
			dailyCount: 3,
			lastResetDay: yesterday,
		};
		// canSendNotification internally calls resetIfNeeded
		const result = canSendNotification(budget);
		expect(result).toBe(true); // reset to 0, so under limit again
	});

	it('recordNotificationSent increments both daily and weekly counts', () => {
		const budget = createDefaultBudget();
		const updated = recordNotificationSent(budget);
		expect(updated.dailyCount).toBe(1);
		expect(updated.weeklyCount).toBe(1);
	});
});

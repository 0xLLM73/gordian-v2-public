import { Composer } from 'grammy';
import type { BotContext } from '../context';

// ─── Notification Budget (pure functions, exported for tests) ────────────────

export interface NotificationBudget {
	dailyCount: number;
	weeklyCount: number;
	consecutiveIgnores: number;
	dailyLimit: number;
	weeklyLimit: number;
	lastResetDay: string; // ISO date string (YYYY-MM-DD)
	lastResetWeek: string; // ISO week string (YYYY-Www)
}

export function createDefaultBudget(): NotificationBudget {
	const now = new Date();
	return {
		dailyCount: 0,
		weeklyCount: 0,
		consecutiveIgnores: 0,
		dailyLimit: 3,
		weeklyLimit: 12,
		lastResetDay: now.toISOString().slice(0, 10),
		lastResetWeek: getISOWeek(now),
	};
}

function getISOWeek(date: Date): string {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
	const week1 = new Date(d.getFullYear(), 0, 4);
	const weekNum =
		1 +
		Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
	return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function resetIfNeeded(budget: NotificationBudget): NotificationBudget {
	const now = new Date();
	const today = now.toISOString().slice(0, 10);
	const thisWeek = getISOWeek(now);

	let updated = { ...budget };
	if (updated.lastResetDay !== today) {
		updated = { ...updated, dailyCount: 0, lastResetDay: today };
	}
	if (updated.lastResetWeek !== thisWeek) {
		updated = { ...updated, weeklyCount: 0, lastResetWeek: thisWeek };
	}
	return updated;
}

export function canSendNotification(budget: NotificationBudget): boolean {
	const b = resetIfNeeded(budget);
	return b.dailyCount < b.dailyLimit && b.weeklyCount < b.weeklyLimit;
}

export function recordNotificationSent(budget: NotificationBudget): NotificationBudget {
	const b = resetIfNeeded(budget);
	return { ...b, dailyCount: b.dailyCount + 1, weeklyCount: b.weeklyCount + 1 };
}

export function recordNotificationIgnored(budget: NotificationBudget): NotificationBudget {
	const b = resetIfNeeded(budget);
	const newIgnores = b.consecutiveIgnores + 1;
	// Escalation: 3+ consecutive ignores -> daily limit drops to 1
	const newDailyLimit = newIgnores >= 3 ? 1 : b.dailyLimit;
	return { ...b, consecutiveIgnores: newIgnores, dailyLimit: newDailyLimit };
}

export function recordNotificationEngaged(budget: NotificationBudget): NotificationBudget {
	const b = resetIfNeeded(budget);
	// Engagement resets consecutive ignores and restores limit
	return { ...b, consecutiveIgnores: 0, dailyLimit: 3 };
}

export function recordMuteEvent(budget: NotificationBudget): NotificationBudget {
	// Mute = treat as 3 consecutive ignores -> throttle to 1/day
	return { ...budget, consecutiveIgnores: 3, dailyLimit: 1 };
}

// ─── Bot Composers ────────────────────────────────────────────────────────────

export const notificationsComposer = new Composer<BotContext>();

notificationsComposer.command('stop', async (ctx) => {
	ctx.session.step = 'idle';

	const budget =
		(ctx.session.data?.notificationBudget as NotificationBudget | undefined) ??
		createDefaultBudget();

	ctx.session.data = {
		...ctx.session.data,
		notificationsPaused: true,
		notificationBudget: recordMuteEvent(budget),
	};

	await ctx.reply('Notifications paused. Use /resume to re-enable.');
});

notificationsComposer.command('resume', async (ctx) => {
	ctx.session.step = 'idle';

	const budget =
		(ctx.session.data?.notificationBudget as NotificationBudget | undefined) ??
		createDefaultBudget();

	ctx.session.data = {
		...ctx.session.data,
		notificationsPaused: false,
		notificationBudget: recordNotificationEngaged(budget),
	};

	await ctx.reply('Notifications resumed. You will receive up to 3 notifications per day.');
});

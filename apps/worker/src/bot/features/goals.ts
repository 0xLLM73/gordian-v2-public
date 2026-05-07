import { Composer } from 'grammy';
import type { BotContext } from '../context';

export const goalsComposer = new Composer<BotContext>();

/** Resolve workspace envelope from session — shared helper */
async function resolveEnvelope(workspaceId: string) {
	const { db, eq, workspaces } = await import('@repo/db');
	const [ws] = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);
	if (!ws) return null;
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

/** Unicode block sparkline from an array of numbers */
function sparkline(values: number[]): string {
	const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
	const max = Math.max(...values, 1);
	return values.map((v) => blocks[Math.min(Math.round((v / max) * 7), 7)]).join('');
}

goalsComposer.command('goals', async (ctx) => {
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;
	if (!workspaceId) {
		await ctx.reply('Please link your account first via the web app.');
		return;
	}

	const { listGoals } = await import('@repo/db');
	const envelope = await resolveEnvelope(workspaceId);
	if (!envelope) {
		await ctx.reply('Workspace not found.');
		return;
	}

	const goalList = await listGoals(workspaceId, { status: 'active', limit: 10 }, envelope);

	if (goalList.length === 0) {
		await ctx.reply('No active goals. Create one from the web dashboard.');
		return;
	}

	const formatted = goalList
		.map((g) => {
			const pct = g.targetCount > 0 ? Math.round((g.currentCount / g.targetCount) * 100) : 0;
			const bar = pct >= 100 ? '✅' : `[${g.currentCount}/${g.targetCount}]`;
			return `${g.type}: ${g.title} ${bar} — ${pct}%`;
		})
		.join('\n');

	await ctx.reply(`Your active goals:\n\n${formatted}`);
});

goalsComposer.command('weekly', async (ctx) => {
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;
	if (!workspaceId) {
		await ctx.reply('Please link your account first via the web app.');
		return;
	}

	const { listGoals, getGoalAnalytics } = await import('@repo/db');
	const envelope = await resolveEnvelope(workspaceId);
	if (!envelope) {
		await ctx.reply('Workspace not found.');
		return;
	}

	const [allGoals, analytics] = await Promise.all([
		listGoals(workspaceId, { limit: 50 }, envelope),
		getGoalAnalytics(workspaceId, envelope),
	]);

	const active = allGoals.filter((g) => g.status === 'active');
	const completedThisWeek = allGoals.filter((g) => {
		if (g.status !== 'completed' || !g.completedAt) return false;
		const weekAgo = Date.now() - 7 * 86400000;
		return new Date(g.completedAt).getTime() > weekAgo;
	});

	const { paceDistribution, velocityTrend, byType } = analytics;
	const atRiskCount = paceDistribution.atRisk;
	const totalPaced =
		paceDistribution.onTrack + paceDistribution.slightlyBehind + paceDistribution.atRisk;

	// Build message
	const lines: string[] = ['📊 Weekly Goals Summary\n'];

	// Overview
	lines.push(`Active: ${active.length}`);
	lines.push(`Completed this week: ${completedThisWeek.length}`);
	if (totalPaced > 0) {
		lines.push(`At risk: ${atRiskCount} of ${totalPaced} with deadlines`);
	}

	// Velocity sparkline
	lines.push(`\nVelocity (14d): ${sparkline(velocityTrend)}`);
	const totalProgress = velocityTrend.reduce((a, b) => a + b, 0);
	lines.push(`Total progress events: ${totalProgress}`);

	// Completion by type
	if (byType.length > 0) {
		lines.push('\nBy type:');
		for (const s of byType) {
			const pct = Math.round(s.completionRate * 100);
			const avg = s.avgDaysToComplete != null ? ` · avg ${s.avgDaysToComplete}d` : '';
			lines.push(`  ${s.type}: ${s.completed}/${s.total} (${pct}%)${avg}`);
		}
	}

	// At-risk goals
	if (atRiskCount > 0) {
		const atRiskGoals = active.filter((g) => {
			if (!g.targetDate || g.targetCount === 0) return false;
			const totalDays =
				(new Date(g.targetDate).getTime() - new Date(g.createdAt).getTime()) / 86400000;
			const daysElapsed = (Date.now() - new Date(g.createdAt).getTime()) / 86400000;
			if (totalDays <= 0 || daysElapsed <= 0) return false;
			const pace = g.currentCount / g.targetCount / Math.min(daysElapsed / totalDays, 1);
			return pace < 0.85;
		});
		if (atRiskGoals.length > 0) {
			lines.push('\n⚠️ At-risk goals:');
			for (const g of atRiskGoals.slice(0, 5)) {
				const daysLeft = g.targetDate
					? Math.max(0, Math.round((new Date(g.targetDate).getTime() - Date.now()) / 86400000))
					: 0;
				lines.push(`  • ${g.title} [${g.currentCount}/${g.targetCount}] — ${daysLeft}d left`);
			}
		}
	}

	await ctx.reply(lines.join('\n'));
});

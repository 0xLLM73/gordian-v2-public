import { Composer } from 'grammy';
import type { BotContext } from '../context';

export const followUpPlansComposer = new Composer<BotContext>();

followUpPlansComposer.command('followups', async (ctx) => {
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;
	if (!workspaceId) {
		await ctx.reply('Please link your account first via the web app.');
		return;
	}

	const { listFollowUpPlans, db, eq, workspaces } = await import('@repo/db');

	// Resolve workspace envelope for encrypted field access
	const [ws] = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);
	if (!ws) {
		await ctx.reply('Workspace not found.');
		return;
	}
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	const envelope = {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};

	const activePlans = await listFollowUpPlans(
		workspaceId,
		{ status: 'active', limit: 10 },
		envelope,
	);
	const pausedPlans = await listFollowUpPlans(
		workspaceId,
		{ status: 'paused', limit: 5 },
		envelope,
	);

	if (activePlans.length === 0 && pausedPlans.length === 0) {
		await ctx.reply('No follow-up plans running. Create one from the web dashboard.');
		return;
	}

	const lines: string[] = [];

	if (activePlans.length > 0) {
		lines.push('Active follow-up plans:');
		for (const p of activePlans) {
			lines.push(`  ${p.title} — step ${p.completedSteps}/${p.totalSteps}`);
		}
	}

	if (pausedPlans.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('Paused follow-up plans:');
		for (const p of pausedPlans) {
			lines.push(`  ${p.title} — step ${p.completedSteps}/${p.totalSteps} (paused)`);
		}
	}

	await ctx.reply(lines.join('\n'));
});

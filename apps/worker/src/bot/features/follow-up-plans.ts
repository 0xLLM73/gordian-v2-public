import { Composer } from 'grammy';
import type { BotContext } from '../context';

export const followUpPlansComposer = new Composer<BotContext>();

followUpPlansComposer.command('followups', async (ctx) => {
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;
	if (!workspaceId) {
		await ctx.reply('Please link your account first via the web app.');
		return;
	}

	const { listFollowUpPlans, getFollowUpPlanSteps, db, eq, workspaces } = await import('@repo/db');

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
	const draftPlans = await listFollowUpPlans(workspaceId, { status: 'draft', limit: 5 }, envelope);

	if (activePlans.length === 0 && pausedPlans.length === 0 && draftPlans.length === 0) {
		await ctx.reply('No follow-up plans running. Create one from the web dashboard.');
		return;
	}

	const activeSummaries = await Promise.all(
		activePlans.map(async (plan) => {
			const steps = plan.id ? await getFollowUpPlanSteps(workspaceId, plan.id, envelope) : [];
			return {
				plan,
				needsReview: steps.filter((step) => step.status === 'pending_review').length,
				failed: steps.filter((step) => step.status === 'failed').length,
			};
		}),
	);
	const needsReview = activeSummaries.filter((summary) => summary.needsReview > 0);
	const lines: string[] = [];

	if (needsReview.length > 0) {
		lines.push('Needs review:');
		for (const { plan, needsReview: reviewCount } of needsReview) {
			lines.push(
				`  ${plan.title} — ${reviewCount} local draft${reviewCount === 1 ? '' : 's'} waiting`,
			);
		}
	}

	if (activeSummaries.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('Active follow-up plans:');
		for (const { plan, needsReview: reviewCount, failed } of activeSummaries) {
			const attention =
				reviewCount > 0 ? `, ${reviewCount} needs review` : failed > 0 ? `, ${failed} failed` : '';
			lines.push(`  ${plan.title} — step ${plan.completedSteps}/${plan.totalSteps}${attention}`);
		}
	}

	if (draftPlans.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('Draft follow-up plans:');
		for (const p of draftPlans) {
			lines.push(`  ${p.title} — not active yet`);
		}
	}

	if (pausedPlans.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('Paused follow-up plans:');
		for (const p of pausedPlans) {
			lines.push(`  ${p.title} — step ${p.completedSteps}/${p.totalSteps} (paused)`);
		}
	}

	lines.push('');
	lines.push('Drafts are generated locally and are not sent automatically.');

	await ctx.reply(lines.join('\n'));
});

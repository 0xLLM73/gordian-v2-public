import { Composer } from 'grammy';
import { digestQueue } from '../../queues/digest';
import type { BotContext } from '../context';

/**
 * Digest Composer — handles on-demand digest generation via Telegram.
 * Users can trigger a weekly digest summary with the /digest command.
 */
export const digestComposer = new Composer<BotContext>();

digestComposer.command('digest', async (ctx) => {
	const telegramId = ctx.from?.id?.toString();
	if (!telegramId) {
		await ctx.reply('Could not determine your Telegram ID.');
		return;
	}

	// Look up userId + workspaceId from accounts table
	try {
		const { accounts, db, eq, and, workspaces } = await import('@repo/db');

		const [account] = await db
			.select({ userId: accounts.userId })
			.from(accounts)
			.where(and(eq(accounts.providerId, 'telegram'), eq(accounts.accountId, telegramId)))
			.limit(1);

		if (!account) {
			await ctx.reply('Please link your account first with /link.');
			return;
		}

		const [ws] = await db
			.select({ id: workspaces.id })
			.from(workspaces)
			.where(eq(workspaces.ownerId, account.userId))
			.limit(1);

		if (!ws) {
			await ctx.reply('No workspace found. Please complete setup on the web app.');
			return;
		}

		// Enqueue digest job for the past week — envelope resolved inside worker (SEC-028)
		const jobId = `digest-${account.userId}-week`;
		await digestQueue.add(
			'generate-digest',
			{
				userId: account.userId,
				workspaceId: ws.id,
				period: 'week',
			},
			{ jobId, priority: 1 },
		);

		const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
		await ctx.reply(
			`Generating your weekly digest...\n\nThis covers the past 7 days of relationship activity.\nCheck the dashboard at ${webUrl}/digest for results.`,
		);
	} catch (err) {
		console.error('[bot] /digest error:', (err as Error).message);
		await ctx.reply('Something went wrong. Please try again later.');
	}
});

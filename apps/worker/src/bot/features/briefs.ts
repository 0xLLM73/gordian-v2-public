import { Composer } from 'grammy';
import { briefQueue } from '../../ai/morning-brief';
import { isTelegramMtProtoEnabled } from '../../telegram-config';
import type { BotContext } from '../context';

/**
 * Briefs Composer — handles daily briefs and summaries.
 * Provides AI-generated summaries of contacts, deals, and recent activity.
 */
export const briefsComposer = new Composer<BotContext>();

briefsComposer.command('brief', async (ctx) => {
	ctx.session.step = 'idle';

	await ctx.reply(
		'Generating your daily brief...\n\n' +
			'This will include:\n' +
			'- Pending commitments\n' +
			'- Recent contact activity\n' +
			'- Suggested follow-ups',
	);

	// Queue an on-demand brief generation job
	const userId = ctx.from?.id?.toString();
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;

	if (!userId || !workspaceId) {
		await ctx.reply('Please complete onboarding first (/start) to set up your workspace.');
		return;
	}

	await briefQueue.add(
		'on-demand-brief',
		{
			userId,
			workspaceId,
			timezone: (ctx.session.data?.timezone as string) ?? 'UTC',
		},
		{ priority: 1 }, // Higher priority for on-demand requests
	);

	await ctx.reply('Your brief is being generated. Check the dashboard for results.');
});

briefsComposer.command('sync', async (ctx) => {
	if (!isTelegramMtProtoEnabled()) {
		await ctx.reply(
			'Telegram contact sync is disabled in this public build. Use the web demo workspace instead.',
		);
		return;
	}

	const userId = ctx.from?.id?.toString();
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;

	if (!userId || !workspaceId) {
		await ctx.reply('Please link your account first via the web app (/start).');
		return;
	}

	await ctx.reply(
		'Starting contact sync...\n\n' + 'This will fetch your latest Telegram contacts and messages.',
	);

	const { syncQueue } = await import('../../queues/sync');
	await syncQueue.add('sync-contacts', { userId, workspaceId });

	await ctx.reply("Contact sync queued. You'll be notified when complete.");
});

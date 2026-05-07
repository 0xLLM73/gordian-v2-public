import { Composer } from 'grammy';
import type { BotContext } from '../context';

/**
 * Callbacks Composer — handles inline keyboard button presses.
 * Handles fulfill/snooze/dismiss patterns for commitment actions.
 * Passes unknown prefixes to next handler (e.g., summaryComposer).
 */
export const callbacksComposer = new Composer<BotContext>();

const KNOWN_PREFIXES = ['fulfill:', 'snooze:', 'dismiss:', 'brief_detail:'] as const;

callbacksComposer.on('callback_query:data', async (ctx, next) => {
	const data = ctx.callbackQuery.data;

	if (!KNOWN_PREFIXES.some((p) => data.startsWith(p))) {
		return next(); // Pass to next handler (e.g., summaryComposer)
	}

	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;
	if (!workspaceId) {
		await ctx.answerCallbackQuery({ text: 'Please complete onboarding first.' });
		return;
	}

	const colonIdx = data.indexOf(':');
	const action = data.slice(0, colonIdx);
	const entityId = data.slice(colonIdx + 1);

	if (!entityId) {
		await ctx.answerCallbackQuery({ text: 'Invalid action.' });
		return;
	}

	try {
		if (action === 'fulfill') {
			const { updateCommitmentStatus } = await import('@repo/db');
			const result = await updateCommitmentStatus(workspaceId, entityId, 'completed');
			if (result) {
				await ctx.answerCallbackQuery({ text: 'Marked as completed!' });
				await ctx.editMessageReplyMarkup({ reply_markup: undefined });
			} else {
				await ctx.answerCallbackQuery({ text: 'Commitment not found or already updated.' });
			}
		} else if (action === 'dismiss') {
			const { updateCommitmentStatus } = await import('@repo/db');
			const result = await updateCommitmentStatus(workspaceId, entityId, 'dismissed');
			if (result) {
				await ctx.answerCallbackQuery({ text: 'Dismissed.' });
				await ctx.editMessageReplyMarkup({ reply_markup: undefined });
			} else {
				await ctx.answerCallbackQuery({ text: 'Commitment not found or already updated.' });
			}
		} else if (action === 'snooze') {
			await ctx.answerCallbackQuery({ text: 'Snoozed. Will remind you later.' });
			await ctx.editMessageReplyMarkup({ reply_markup: undefined });
		} else if (action === 'brief_detail') {
			// Expand brief section — entityId is the section key (e.g., "commitments", "followups", "activity")
			await ctx.answerCallbackQuery();
			const section = entityId;
			const envelopeData = ctx.session.data?.envelope as
				| { encryptedWrk: string; kmsContext: Record<string, string>; wrkVersion: number }
				| undefined;

			if (!envelopeData) {
				await ctx.reply('Encryption keys not available. Please reconnect via the web app.');
				return;
			}

			const envelope = {
				encryptedWrk: Buffer.from(envelopeData.encryptedWrk, 'base64'),
				kmsContext: envelopeData.kmsContext,
				wrkVersion: envelopeData.wrkVersion,
			};

			try {
				if (section === 'commitments') {
					const { getActiveCommitments } = await import('@repo/db');
					const items = await getActiveCommitments(workspaceId, envelope, { limit: 10 });
					if (items.length === 0) {
						await ctx.reply('No active commitments found.');
					} else {
						const text = items
							.map((c: Record<string, unknown>, i: number) => `${i + 1}. ${c.title ?? 'Untitled'}`)
							.join('\n');
						await ctx.reply(`Active commitments:\n\n${text}`);
					}
				} else if (section === 'followups') {
					const { getActiveCommitments } = await import('@repo/db');
					const items = await getActiveCommitments(workspaceId, envelope, { limit: 10 });
					const overdue = items.filter((c: Record<string, unknown>) => {
						const due = c.dueDate as string | null;
						return due && new Date(due) < new Date();
					});
					if (overdue.length === 0) {
						await ctx.reply("No overdue follow-ups. You're all caught up!");
					} else {
						const text = overdue
							.map(
								(c: Record<string, unknown>, i: number) =>
									`${i + 1}. ${c.title ?? 'Untitled'} (due: ${c.dueDate})`,
							)
							.join('\n');
						await ctx.reply(`Overdue follow-ups:\n\n${text}`);
					}
				} else if (section === 'activity') {
					await ctx.reply('Recent activity details are available on the web dashboard.');
				} else {
					await ctx.reply(`Details for "${section}" are not available.`);
				}
			} catch (err) {
				console.error('[callbacks] brief_detail error:', (err as Error).message);
				await ctx.reply('Failed to load details. Try again later.');
			}
		} else {
			await ctx.answerCallbackQuery({ text: 'Unknown action.' });
		}
	} catch (err) {
		console.error('[callbacks] Error handling callback:', (err as Error).message);
		await ctx.answerCallbackQuery({ text: 'Something went wrong. Try again.' });
	}
});

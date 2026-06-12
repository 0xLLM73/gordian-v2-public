import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../context';

/**
 * Summary Composer — contact summary lookup via /summary <name>.
 * Supports disambiguation when multiple contacts match.
 */
export const summaryComposer = new Composer<BotContext>();

summaryComposer.command('summary', async (ctx) => {
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;

	if (!workspaceId) {
		await ctx.reply('Please complete onboarding first (/start).');
		return;
	}

	const nameArg = ctx.match?.toString().trim();
	if (!nameArg) {
		await ctx.reply('Usage: /summary <contact name>\n\nExample: /summary Alice');
		return;
	}

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

	const { searchContactByName } = await import('@repo/db');
	const contacts = await searchContactByName(workspaceId, nameArg, envelope);

	if (contacts.length === 0) {
		await ctx.reply(`No contacts found matching "${nameArg}".`);
		return;
	}

	if (contacts.length === 1) {
		await sendContactSummary(ctx, workspaceId, contacts[0], envelope);
		return;
	}

	// Multiple matches — inline keyboard for disambiguation
	ctx.session.step = 'summary_select';
	const keyboard = new InlineKeyboard();
	for (const contact of contacts.slice(0, 5)) {
		const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
		keyboard.text(name, `summary_select:${contact.id}`).row();
	}

	await ctx.reply('Multiple contacts found. Which one?', { reply_markup: keyboard });
});

// Handle summary_select callback (filtered to avoid conflict with callbacksComposer)
summaryComposer.on('callback_query:data').filter(
	(ctx) => ctx.callbackQuery.data.startsWith('summary_select:'),
	async (ctx) => {
		const contactId = ctx.callbackQuery.data.replace('summary_select:', '');
		const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;

		if (!workspaceId) {
			await ctx.answerCallbackQuery({ text: 'Session expired.' });
			return;
		}

		const envelopeData = ctx.session.data?.envelope as
			| { encryptedWrk: string; kmsContext: Record<string, string>; wrkVersion: number }
			| undefined;

		if (!envelopeData) {
			await ctx.answerCallbackQuery({ text: 'Encryption keys not available.' });
			return;
		}

		const envelope = {
			encryptedWrk: Buffer.from(envelopeData.encryptedWrk, 'base64'),
			kmsContext: envelopeData.kmsContext,
			wrkVersion: envelopeData.wrkVersion,
		};

		const { getContact } = await import('@repo/db');
		const contact = await getContact(workspaceId, contactId, envelope);
		if (!contact) {
			await ctx.answerCallbackQuery({ text: 'Contact not found.' });
			return;
		}

		await ctx.answerCallbackQuery();
		ctx.session.step = 'idle';
		await sendContactSummary(ctx, workspaceId, contact, envelope);
	},
);

type Envelope = { encryptedWrk: Buffer; kmsContext: Record<string, string>; wrkVersion: number };

async function sendContactSummary(
	ctx: BotContext,
	workspaceId: string,
	contact: Record<string, unknown>,
	envelope: Envelope,
) {
	const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';

	const { getLatestSummary } = await import('@repo/db');
	const summary = await getLatestSummary(workspaceId, contact.id as string, envelope);

	if (!summary) {
		await ctx.reply(
			`${name}: No summary available yet. A summary will be generated after the next sync.`,
		);
		return;
	}

	const s = summary as Record<string, unknown>;
	const summaryText = s.summary as string;
	const generatedAt = s.generatedAt as string | undefined;
	const dateStr = generatedAt ? new Date(generatedAt).toLocaleDateString() : 'Unknown';

	await ctx.reply(`${name}\n\n${summaryText || 'No summary text.'}\n\n(Generated: ${dateStr})`);
}

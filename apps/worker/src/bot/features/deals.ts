import { Composer } from 'grammy';
import type { BotContext } from '../context';

/**
 * Deals Composer — handles deal management via Telegram.
 * Users can create, view, and update deals through conversation.
 */
export const dealsComposer = new Composer<BotContext>();

dealsComposer.command('deals', async (ctx) => {
	ctx.session.step = 'idle';

	await ctx.reply(
		'Deal Management:\n\n' +
			'/newdeal — Create a new deal\n' +
			'/mydeals — List your active deals\n\n' +
			"Or just tell me about a deal and I'll help you track it.",
	);
});

dealsComposer.command('newdeal', async (ctx) => {
	ctx.session.step = 'deal_title';
	ctx.session.data = {};

	await ctx.reply("What's the deal title?");
});

// Handle deal creation flow
dealsComposer.on('message:text').filter(
	(ctx) => ctx.session.step === 'deal_title',
	async (ctx) => {
		ctx.session.data = { ...ctx.session.data, title: ctx.message.text.trim() };
		ctx.session.step = 'deal_value';

		await ctx.reply("What's the deal value? (e.g., 5000 or 5k)");
	},
);

dealsComposer.on('message:text').filter(
	(ctx) => ctx.session.step === 'deal_value',
	async (ctx) => {
		const valueStr = ctx.message.text.trim().toLowerCase();
		let value = 0;

		if (valueStr.endsWith('k')) {
			value = Number.parseFloat(valueStr) * 1000;
		} else if (valueStr.endsWith('m')) {
			value = Number.parseFloat(valueStr) * 1_000_000;
		} else {
			value = Number.parseFloat(valueStr);
		}

		if (Number.isNaN(value) || value <= 0) {
			await ctx.reply('Please enter a valid deal value (e.g., 5000 or 5k):');
			return;
		}

		ctx.session.data = { ...ctx.session.data, value };
		ctx.session.step = 'deal_contact';

		await ctx.reply('Which contact is this deal with? (Enter their name or skip with /skip)');
	},
);

dealsComposer.on('message:text').filter(
	(ctx) => ctx.session.step === 'deal_contact',
	async (ctx) => {
		const contactName = ctx.message.text.trim();
		const data = ctx.session.data ?? {};
		const workspaceId = (data.workspaceId as string) ?? undefined;

		ctx.session.step = 'idle';

		if (!workspaceId) {
			await ctx.reply('Please link your account first via the web app.');
			return;
		}

		const envelopeData = ctx.session.data?.envelope as
			| { encryptedWrk: string; kmsContext: Record<string, string>; wrkVersion: number }
			| undefined;

		let contactId: string | null = null;
		let resolvedName = contactName;

		if (envelopeData) {
			const envelope = {
				encryptedWrk: Buffer.from(envelopeData.encryptedWrk, 'base64'),
				kmsContext: envelopeData.kmsContext,
				wrkVersion: envelopeData.wrkVersion,
			};

			const { searchContactByName } = await import('@repo/db');
			const contacts = await searchContactByName(workspaceId, contactName, envelope);

			if (contacts.length > 0) {
				contactId = contacts[0].id;
				const name = [contacts[0].firstName, contacts[0].lastName].filter(Boolean).join(' ');
				if (name) resolvedName = name;
			} else {
				await ctx.reply(
					`No contact found matching "${contactName}". Deal created without a linked contact.`,
				);
			}
		}

		if (!envelopeData) {
			await ctx.reply('Encryption keys not available. Please re-link your account.');
			return;
		}

		const { createDeal } = await import('@repo/db');
		const envelope = {
			encryptedWrk: Buffer.from(envelopeData.encryptedWrk, 'base64'),
			kmsContext: envelopeData.kmsContext,
			wrkVersion: envelopeData.wrkVersion,
		};

		await createDeal(
			workspaceId,
			{
				contactId: contactId ?? 'unlinked',
				title: data.title as string,
				value: Math.round((data.value as number) * 100),
			},
			envelope,
		);

		const contactLine = contactId ? `  Contact: ${resolvedName}\n` : '';
		await ctx.reply(
			`Deal created:\n  Title: ${data.title}\n  Value: $${(data.value as number)?.toLocaleString()}\n${contactLine}\nI'll track this deal for you.`,
		);
	},
);

dealsComposer.command('skip', async (ctx) => {
	if (ctx.session.step === 'deal_contact') {
		const data = ctx.session.data ?? {};
		const workspaceId = (data.workspaceId as string) ?? undefined;

		ctx.session.step = 'idle';

		if (!workspaceId) {
			await ctx.reply('Please link your account first via the web app.');
			return;
		}

		const envelopeData = ctx.session.data?.envelope as
			| { encryptedWrk: string; kmsContext: Record<string, string>; wrkVersion: number }
			| undefined;

		if (!envelopeData) {
			await ctx.reply('Encryption keys not available. Please re-link your account.');
			return;
		}

		const { createDeal } = await import('@repo/db');
		const envelope = {
			encryptedWrk: Buffer.from(envelopeData.encryptedWrk, 'base64'),
			kmsContext: envelopeData.kmsContext,
			wrkVersion: envelopeData.wrkVersion,
		};

		await createDeal(
			workspaceId,
			{
				contactId: 'unlinked',
				title: data.title as string,
				value: Math.round((data.value as number) * 100),
			},
			envelope,
		);

		await ctx.reply(
			`Deal created:\n  Title: ${data.title}\n  Value: $${(data.value as number)?.toLocaleString()}\n\nI'll track this deal for you.`,
		);
	}
});

dealsComposer.command('mydeals', async (ctx) => {
	const workspaceId = (ctx.session.data?.workspaceId as string) ?? undefined;
	if (!workspaceId) {
		await ctx.reply('Please link your account first via the web app.');
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

	const { listDeals } = await import('@repo/db');
	const dealList = await listDeals(workspaceId, envelope, { limit: 10 });

	if (dealList.length === 0) {
		await ctx.reply('No active deals yet. Create one with /newdeal.');
		return;
	}
	const formatted = dealList
		.map((d, i) => {
			const contactName = [d.contactFirstName, d.contactLastName].filter(Boolean).join(' ') || '';
			const contactInfo = contactName ? ` (${contactName})` : '';
			return `${i + 1}. ${d.title} — $${d.value.toLocaleString()} [${d.stage}]${contactInfo}`;
		})
		.join('\n');
	await ctx.reply(`Your deals:\n\n${formatted}`);
});

import { Composer } from 'grammy';
import { isTelegramMtProtoEnabled } from '../../telegram-config';
import type { BotContext } from '../context';

/**
 * Onboarding Composer — handles new user setup via Telegram.
 * Guides users through initial account linking and workspace setup.
 */
export const onboardingComposer = new Composer<BotContext>();

const telegramLinkingDisabledMessage =
	'Telegram account linking is disabled in this public build. Use the web demo workspace instead.';

onboardingComposer.command('start', async (ctx) => {
	ctx.session.step = 'idle';
	ctx.session.data = {};

	await ctx.reply(
		`Welcome to Gordian CRM! I help you manage your contacts and deals.\n\n${
			isTelegramMtProtoEnabled()
				? 'Use /link to connect your Telegram account.\n'
				: `${telegramLinkingDisabledMessage}\n`
		}Use /help to see all available commands.`,
	);
});

onboardingComposer.command('link', async (ctx) => {
	if (!isTelegramMtProtoEnabled()) {
		await ctx.reply(telegramLinkingDisabledMessage);
		return;
	}

	const telegramId = ctx.from?.id?.toString();
	if (!telegramId) {
		await ctx.reply('Could not determine your Telegram ID.');
		return;
	}

	try {
		// Check if user already has a linked account
		const { accounts, db, eq, and } = await import('@repo/db');
		const [account] = await db
			.select({ userId: accounts.userId })
			.from(accounts)
			.where(and(eq(accounts.providerId, 'telegram'), eq(accounts.accountId, telegramId)))
			.limit(1);

		if (account) {
			// User is linked — generate handoff token for web access
			const { workspaces } = await import('@repo/db');
			const [ws] = await db
				.select({ id: workspaces.id })
				.from(workspaces)
				.where(eq(workspaces.ownerId, account.userId))
				.limit(1);

			if (ws) {
				const { createHandoffToken } = await import('@repo/shared/handoff-token');
				const token = await createHandoffToken({
					userId: account.userId,
					workspaceId: ws.id,
					action: 'bot-link',
				});
				const webUrl = process.env.WEB_URL || 'http://localhost:3000';
				await ctx.reply(
					`Your account is already linked.\n\nOpen the dashboard:\n${webUrl}/onboarding/telegram-link?token=${token}\n\n(This link expires in 60 seconds.)`,
				);
			} else {
				await ctx.reply(
					'Your Telegram is linked, but no workspace was found. Please complete setup on the web app.',
				);
			}
			return;
		}

		// Not linked — start phone number flow
		ctx.session.step = 'onboarding_phone';
		await ctx.reply(
			'To link your Telegram account, please share your phone number or type it in international format (e.g., +1234567890).',
		);
	} catch (err) {
		console.error('[bot] /link error:', (err as Error).message);
		await ctx.reply('Something went wrong. Please try again later.');
	}
});

onboardingComposer.command('help', async (ctx) => {
	const telegramCommands = isTelegramMtProtoEnabled()
		? '/link — Link your Telegram account\n/sync — Sync your Telegram contacts\n'
		: `${telegramLinkingDisabledMessage}\n`;

	await ctx.reply(
		`Available commands:\n\n/start — Start the bot\n${telegramCommands}/deals — Manage your deals\n/brief — Get a daily brief\n/digest — Generate a weekly activity digest\n/summary <name> — Contact summary\n/stop — Pause notifications\n/resume — Resume notifications\n/cancel — Cancel current action\n/help — Show this message`,
	);
});

onboardingComposer.command('cancel', async (ctx) => {
	ctx.session.step = 'idle';
	ctx.session.data = { ...ctx.session.data };
	await ctx.reply('Action cancelled. Back to idle.');
});

// Handle onboarding flow messages
onboardingComposer.on('message:text').filter(
	(ctx) => ctx.session.step === 'onboarding_phone',
	async (ctx) => {
		const phone = ctx.message.text.trim();

		if (!/^\+\d{7,15}$/.test(phone)) {
			await ctx.reply(
				'Please enter a valid phone number in international format (e.g., +1234567890).',
			);
			return;
		}

		ctx.session.data = { ...ctx.session.data, phone };
		ctx.session.step = 'onboarding_confirm';

		await ctx.reply(
			`Phone: ${phone}\n\nIs this correct? Reply "yes" to confirm or "no" to re-enter.`,
		);
	},
);

onboardingComposer.on('message:text').filter(
	(ctx) => ctx.session.step === 'onboarding_confirm',
	async (ctx) => {
		const text = ctx.message.text.toLowerCase().trim();

		if (text === 'yes') {
			ctx.session.step = 'idle';
			if (!isTelegramMtProtoEnabled()) {
				await ctx.reply(telegramLinkingDisabledMessage);
				return;
			}
			await ctx.reply('Account linking initiated. You will receive a verification code shortly.');
			// TODO: Phase 5 — Trigger actual linking flow via web tier
		} else if (text === 'no') {
			ctx.session.step = 'onboarding_phone';
			await ctx.reply('Please enter your phone number again:');
		} else {
			await ctx.reply('Please reply "yes" or "no".');
		}
	},
);

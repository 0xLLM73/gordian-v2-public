import { Composer } from 'grammy';
import type { BotContext } from '../context';

export const calibrationComposer = new Composer<BotContext>();

calibrationComposer.command('calibrate', async (ctx) => {
	const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
	await ctx.reply(
		`Calibration personalizes your AI outputs — briefs, summaries, and drafts will match your style and priorities.\n\nComplete the setup here: ${webUrl}/settings/calibration`,
	);
});

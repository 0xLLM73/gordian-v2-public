import { sequentialize } from '@grammyjs/runner';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { Bot, session } from 'grammy';
import { connection } from '../redis';
import type { BotContext, SessionData } from './context';
import { briefsComposer } from './features/briefs';
import { calibrationComposer } from './features/calibration';
import { callbacksComposer } from './features/callbacks';
import { dealsComposer } from './features/deals';
import { digestComposer } from './features/digest';
import { followUpPlansComposer } from './features/follow-up-plans';
import { goalsComposer } from './features/goals';
import { notificationsComposer } from './features/notifications';
import { onboardingComposer } from './features/onboarding';
import { summaryComposer } from './features/summary';

export const GRAMMY_SESSION_KEY_PREFIX = 'grammy:session:';

/**
 * Strip PII from a Telegram Update object before logging (SEC-025).
 * Retains structural info (IDs, types, timestamps) but omits names, text, and phone numbers.
 */
export function sanitizeUpdate(update: Record<string, unknown>): Record<string, unknown> {
	return {
		update_id: update.update_id,
		...(update.message
			? {
					message: {
						message_id: (update.message as Record<string, unknown>).message_id,
						chat_id: ((update.message as Record<string, unknown>).chat as Record<string, unknown>)
							?.id,
						chat_type: ((update.message as Record<string, unknown>).chat as Record<string, unknown>)
							?.type,
						date: (update.message as Record<string, unknown>).date,
						// NO: text, from.first_name, from.last_name, from.phone_number
					},
				}
			: {}),
		...(update.callback_query
			? {
					callback_query: {
						id: (update.callback_query as Record<string, unknown>).id,
						data: (update.callback_query as Record<string, unknown>).data,
						// NO: from.first_name, from.last_name
					},
				}
			: {}),
	};
}

/**
 * Initialize grammY bot with Composer pattern (pillar6).
 *
 * - sequentialize() prevents race conditions on per-user state
 * - Redis session storage via DragonflyDB
 * - Feature Composers for modular command handling
 */
export async function initBot(): Promise<Bot<BotContext>> {
	const botToken = process.env.BOT_TOKEN;
	if (!botToken) throw new Error('BOT_TOKEN must be set when TELEGRAM_BOT_ENABLED=true');
	const bot = new Bot<BotContext>(botToken);

	// CRITICAL: sequentialize() prevents race conditions on per-user state (pillar6)
	// Messages from the same chat are processed serially
	bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

	// Session middleware with DragonflyDB storage
	bot.use(
		session<SessionData, BotContext>({
			initial: (): SessionData => ({ step: 'idle' }),
			prefix: GRAMMY_SESSION_KEY_PREFIX,
			storage: new RedisAdapter<SessionData>({ instance: connection }),
		}),
	);

	// Register feature Composers (callbacksComposer FIRST — needs priority)
	bot.use(callbacksComposer);
	bot.use(onboardingComposer);
	bot.use(dealsComposer);
	bot.use(briefsComposer);
	bot.use(notificationsComposer);
	bot.use(summaryComposer);
	bot.use(goalsComposer);
	bot.use(followUpPlansComposer);
	bot.use(calibrationComposer);
	bot.use(digestComposer);

	// Error handler
	bot.catch((err) => {
		console.error('[bot] Error:', err.error);
		console.error(
			'[bot] Update:',
			JSON.stringify(sanitizeUpdate(err.ctx.update as unknown as Record<string, unknown>)),
		);
	});

	return bot;
}

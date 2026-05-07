import type { Context, SessionFlavor } from 'grammy';

/**
 * Session data stored in DragonflyDB via @grammyjs/storage-redis.
 */
export interface SessionData {
	/** Current conversation step */
	step:
		| 'idle'
		| 'onboarding_name'
		| 'onboarding_phone'
		| 'onboarding_confirm'
		| 'deal_title'
		| 'deal_value'
		| 'deal_contact'
		| 'brief_request'
		| 'summary_select';
	/** Temporary data for multi-step flows */
	data?: Record<string, unknown>;
}

/**
 * Custom bot context with session support.
 */
export type BotContext = Context & SessionFlavor<SessionData>;

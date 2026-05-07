import { Bot } from 'grammy';

/**
 * Lightweight Bot singleton for API-only usage (sendMessage, etc.).
 * Does NOT start polling — grammY supports multiple Bot instances on the same token.
 * Used by background workers (morning brief, notifications) that need to push messages.
 */
let botApi: Bot | null = null;

export function getBotApi(): Bot {
	if (!botApi) {
		const token = process.env.BOT_TOKEN;
		if (!token) throw new Error('BOT_TOKEN not set');
		botApi = new Bot(token);
	}
	return botApi;
}

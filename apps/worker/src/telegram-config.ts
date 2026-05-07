const TRUE_VALUE = 'true';

function isEnabled(value: string | undefined): boolean {
	return value?.toLowerCase() === TRUE_VALUE;
}

export function isTelegramBotEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_BOT_ENABLED);
}

export function isTelegramMtProtoEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_MTPROTO_ENABLED);
}

export function isTelegramSendEnabled(): boolean {
	return isEnabled(process.env.TELEGRAM_SEND_ENABLED);
}

export function requireTelegramMtProtoConfig(): { apiId: number; apiHash: string } {
	if (!isTelegramMtProtoEnabled()) {
		throw new Error('Telegram MTProto integration is disabled');
	}

	const apiId = Number(process.env.TELEGRAM_API_ID);
	const apiHash = process.env.TELEGRAM_API_HASH;

	if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
		throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured');
	}

	return { apiId, apiHash };
}

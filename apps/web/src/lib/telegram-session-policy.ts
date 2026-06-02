export function isStoredSessionUnwrapOutsideImportsAllowed(): boolean {
	if (process.env.NODE_ENV === 'test') return true;
	return process.env.TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS?.trim() === 'true';
}

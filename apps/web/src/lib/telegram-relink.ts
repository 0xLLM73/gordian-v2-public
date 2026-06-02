export function isTelegramRelinkAllowed(
	existingUserId: string,
	authenticatedUserId: string,
): boolean {
	return existingUserId === authenticatedUserId;
}

import { isTelegramRelinkAllowed } from '@/lib/telegram-relink';
import { describe, expect, it } from 'vitest';

describe('Telegram relink authorization', () => {
	it('allows a user to refresh their own Telegram session', () => {
		expect(isTelegramRelinkAllowed('user-1', 'user-1')).toBe(true);
	});

	it('rejects relinking an existing Telegram account to a different user', () => {
		expect(isTelegramRelinkAllowed('owner-user', 'attacker-user')).toBe(false);
	});
});

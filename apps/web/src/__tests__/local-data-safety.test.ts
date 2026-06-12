import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DEMO_LOGIN_LOCAL_TELEGRAM_DATA_MESSAGE,
	DEMO_LOGIN_SAFETY_CHECK_FAILED_MESSAGE,
	getDemoLoginSafety,
	isDemoCredentialEmail,
	resolveDemoLoginSafety,
	shouldBlockDemoCredentialSignIn,
} from '@/lib/local-data-safety';

vi.mock('@repo/db', () => ({
	accounts: {},
	chats: {},
	contacts: {},
	db: {},
	eq: vi.fn(),
	sql: vi.fn(),
}));

describe('local data safety', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('matches the demo credential email case-insensitively', () => {
		expect(isDemoCredentialEmail(' Alice@Gordian.Dev ', 'alice@gordian.dev')).toBe(true);
		expect(isDemoCredentialEmail('other@gordian.dev', 'alice@gordian.dev')).toBe(false);
		expect(isDemoCredentialEmail(null, 'alice@gordian.dev')).toBe(false);
	});

	it('removes the browser-visible demo password when local Telegram data exists', () => {
		const safety = resolveDemoLoginSafety({
			demoEmail: 'alice@gordian.dev',
			demoLoginEnabled: true,
			demoPassword: 'local-demo-password',
			hasLocalTelegramData: true,
		});

		expect(safety).toEqual({
			disabledReason: DEMO_LOGIN_LOCAL_TELEGRAM_DATA_MESSAGE,
			email: 'alice@gordian.dev',
			enabled: true,
			password: '',
		});
	});

	it('allows the demo helper before Telegram data exists', () => {
		const safety = resolveDemoLoginSafety({
			demoEmail: 'alice@gordian.dev',
			demoLoginEnabled: true,
			demoPassword: 'local-demo-password',
			hasLocalTelegramData: false,
		});

		expect(safety.disabledReason).toBeNull();
		expect(safety.password).toBe('local-demo-password');
	});

	it('blocks only the demo credential when local Telegram data exists', () => {
		expect(
			shouldBlockDemoCredentialSignIn({
				demoEmail: 'alice@gordian.dev',
				demoLoginEnabled: true,
				email: 'alice@gordian.dev',
				hasLocalTelegramData: true,
			}),
		).toBe(true);

		expect(
			shouldBlockDemoCredentialSignIn({
				demoEmail: 'alice@gordian.dev',
				demoLoginEnabled: true,
				email: 'operator@gordian.dev',
				hasLocalTelegramData: true,
			}),
		).toBe(false);
	});

	it('keeps the explicit override available for controlled local debugging', () => {
		expect(
			shouldBlockDemoCredentialSignIn({
				allowOverride: true,
				demoEmail: 'alice@gordian.dev',
				demoLoginEnabled: true,
				email: 'alice@gordian.dev',
				hasLocalTelegramData: true,
			}),
		).toBe(false);
	});

	it('fails closed when the local Telegram data check cannot run', async () => {
		vi.stubEnv('NEXT_PUBLIC_DEMO_LOGIN_ENABLED', 'true');
		const safety = await getDemoLoginSafety();

		expect(safety).toEqual({
			disabledReason: DEMO_LOGIN_SAFETY_CHECK_FAILED_MESSAGE,
			email: 'alice@gordian.dev',
			enabled: true,
			password: '',
		});
	});
});

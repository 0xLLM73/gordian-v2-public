import { createHash } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

function deterministicUUID(name: string): string {
	const hash = createHash('sha256').update(`gordian-seed:${name}`).digest('hex');
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		`4${hash.slice(13, 16)}`,
		`8${hash.slice(17, 20)}`,
		hash.slice(20, 32),
	].join('-');
}

const seed = {
	workspaceId: deterministicUUID('alice-workspace'),
	contactId: deterministicUUID('alice-contact-aptos-fund'),
	dealId: deterministicUUID('alice-deal-aptos-series'),
	legacyGoalId: '550e8400-e29b-41d4-a716-446655440003',
};

const oldProviderHostPattern = new RegExp(
	['gordian\\.lol', 'gordian-worker\\.internal', ['api', 'ca' + 'bal'].join('\\.')].join('|'),
	'i',
);

const secretPatterns: Array<{ label: string; pattern: RegExp }> = [
	{ label: 'Telegram Bot API URL', pattern: /https:\/\/api\.telegram\.org\/bot/i },
	{ label: 'Telegram bot token', pattern: /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/ },
	{
		label: 'Telegram session material',
		pattern: /telegram-session|encryptedSession|sessionKekEncrypted|phoneCodeHash/i,
	},
	{ label: 'Telegram API hash assignment', pattern: /TELEGRAM_API_HASH\s*=/i },
	{ label: 'bearer token', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i },
	{ label: 'database URL', pattern: /(postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/)/i },
	{ label: 'Redis URL', pattern: /rediss?:\/\//i },
	{
		label: 'secret key',
		pattern: /(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})/i,
	},
	{ label: 'raw seeded Telegram ID', pattern: /\b(?:10000[1-4]|20000[1-4]|30000[1-4])\b/ },
	{
		label: 'old provider infrastructure',
		pattern: oldProviderHostPattern,
	},
];

function installReleaseGuards(page: Page) {
	const consoleMessages: string[] = [];
	const pageErrors: string[] = [];

	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning') {
			consoleMessages.push(`${message.type()}: ${message.text()}`);
		}
	});

	page.on('pageerror', (error) => {
		pageErrors.push(error.message);
	});

	return {
		reset() {
			consoleMessages.length = 0;
			pageErrors.length = 0;
		},
		async assertClean(routeLabel: string) {
			await expect(page.getByText(/Unhandled Runtime Error|Hydration failed/i)).toHaveCount(0);
			await expect(page.getByText(/^Application error:/i)).toHaveCount(0);

			const visibleText = await page.locator('body').innerText();
			const combined = [visibleText, ...consoleMessages, ...pageErrors].join('\n');
			for (const { label, pattern } of secretPatterns) {
				expect(pattern.test(combined), `${label} leaked on ${routeLabel}`).toBe(false);
			}

			expect(pageErrors, `page errors on ${routeLabel}`).toEqual([]);
			expect(consoleMessages, `console warnings/errors on ${routeLabel}`).toEqual([]);
		},
	};
}

async function waitForQuietPage(page: Page) {
	await page.waitForLoadState('domcontentloaded');
	await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
	await expect(page.locator('body')).not.toHaveText('');
}

type ReleaseRoute = {
	path: string;
	label: string;
	text: string | RegExp;
	afterLoad?: (page: Page) => Promise<void>;
};

async function visitAndAssert(
	page: Page,
	guards: ReturnType<typeof installReleaseGuards>,
	route: ReleaseRoute,
) {
	await test.step(route.label, async () => {
		guards.reset();
		await page.goto(route.path, { waitUntil: 'domcontentloaded' });
		await waitForQuietPage(page);
		await expect(page.locator('body')).toContainText(route.text);
		await route.afterLoad?.(page);
		await guards.assertClean(route.label);
	});
}

const desktopRoutes: ReleaseRoute[] = [
	{ path: '/', label: 'dashboard', text: 'Dashboard' },
	{ path: '/contacts', label: 'contacts list', text: 'Marcus Chen' },
	{ path: `/contacts/${seed.contactId}`, label: 'contact detail', text: 'Marcus Chen' },
	{ path: '/deals', label: 'deals list', text: 'Aptos Series A' },
	{ path: `/deals/${seed.dealId}`, label: 'deal detail', text: 'Aptos Series A' },
	{ path: '/commitments', label: 'commitments', text: 'Wire $2M for Aptos SAFT' },
	{ path: '/goals', label: 'goals', text: 'Goals' },
	{ path: '/follow-up-plans', label: 'follow-up plans', text: 'Follow-up Plans' },
	{
		path: `/follow-up-plans?new=1&contactId=${seed.contactId}&goalId=${seed.legacyGoalId}`,
		label: 'follow-up wizard deep link',
		text: 'Follow-up Plans',
		afterLoad: async (activePage) => {
			await expect(
				activePage.getByText(/Template|Manual fallback|reminders/i).first(),
			).toBeVisible();
		},
	},
	{ path: '/knowledge', label: 'knowledge', text: 'Knowledge' },
	{
		path: '/search',
		label: 'search',
		text: 'Search',
		afterLoad: async (activePage) => {
			await activePage
				.getByPlaceholder('Search contacts, memories, commitments, deals, goals...')
				.fill('Aptos');
			await activePage.getByRole('button', { name: 'Search' }).click();
			await expect(
				activePage.getByText(/No embedding request|Query masked before embeddings/),
			).toBeVisible();
		},
	},
	{ path: '/digest', label: 'digest', text: 'Daily Digest' },
	{ path: '/introductions', label: 'introductions', text: 'Introductions' },
	{ path: '/network', label: 'network', text: 'Network' },
	{ path: '/settings', label: 'settings', text: 'Message sending disabled in this build.' },
	{ path: '/settings/audit', label: 'audit log', text: 'Audit Log' },
	{ path: '/settings/learning', label: 'learning queue', text: 'AI Learning Queue' },
	{ path: '/tokens', label: 'tokens', text: 'Tokens' },
	{
		path: '/onboarding/connect',
		label: 'onboarding connect',
		text: 'Telegram linking is disabled',
	},
	{ path: '/onboarding/sync', label: 'onboarding sync', text: 'Telegram sync is disabled' },
	{
		path: '/onboarding/verify',
		label: 'onboarding verify',
		text: 'Telegram linking is disabled',
	},
];

for (const route of desktopRoutes) {
	test(`desktop ${route.label} renders without sensitive leaks`, async ({ page }) => {
		const guards = installReleaseGuards(page);
		await visitAndAssert(page, guards, route);
	});
}

const onboardingState = {
	phone: '',
	normalizedPhone: '',
	consentAcknowledged: true,
	workspaceId: seed.workspaceId,
};

const onboardingRoutes: ReleaseRoute[] = [
	{ path: '/onboarding/what-matters', label: 'what matters', text: 'What matters to you?' },
	{
		path: '/onboarding/calibrate',
		label: 'calibrate',
		text: /How do you write\?|first look|Skip/i,
	},
	{
		path: '/onboarding/first-look',
		label: 'first look',
		text: /Here's what we found|Reconnect/i,
	},
	{
		path: '/onboarding',
		label: 'onboarding redirect',
		text: /Telegram linking is disabled|How do you write\?|Here's what we found/i,
	},
];

for (const route of onboardingRoutes) {
	test(`onboarding ${route.label} renders without sensitive leaks`, async ({ page }) => {
		await page.addInitScript((state) => {
			window.sessionStorage.setItem('gordian-onboarding', JSON.stringify(state));
		}, onboardingState);
		const guards = installReleaseGuards(page);
		await visitAndAssert(page, guards, route);
	});
}

const mobileRoutes: ReleaseRoute[] = [
	{ path: '/deals', label: 'mobile deals', text: 'Aptos Series A' },
	{ path: `/deals/${seed.dealId}`, label: 'mobile deal detail', text: 'Aptos Series A' },
	{ path: '/follow-up-plans', label: 'mobile follow-up plans', text: 'Follow-up Plans' },
	{
		path: '/settings',
		label: 'mobile settings',
		text: 'Message sending disabled in this build.',
	},
	{ path: '/search', label: 'mobile search', text: 'Search' },
	{
		path: '/onboarding/connect',
		label: 'mobile onboarding connect',
		text: 'Telegram linking is disabled',
	},
];

for (const route of mobileRoutes) {
	test(`${route.label} renders without sensitive leaks`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const guards = installReleaseGuards(page);
		await visitAndAssert(page, guards, route);
	});
}

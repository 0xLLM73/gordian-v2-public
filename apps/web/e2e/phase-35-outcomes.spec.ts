import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

// Contact with 4 seeded outcomes (workspace 19f39ea2)
const CONTACT_ID = 'c6447afc-5ba1-4c21-af08-fce4528bd310';

test.describe('Phase 35 — Outcomes History (authenticated)', () => {
	test.use({ storageState: AUTH_FILE });

	test('History tab renders with outcome badges', async ({ page }) => {
		await page.goto(`/contacts/${CONTACT_ID}`);
		await expect(page).toHaveURL(new RegExp(`/contacts/${CONTACT_ID}`));
		await page.waitForLoadState('networkidle');

		// Click the History button (tabs render as buttons in navigation)
		await page.getByRole('button', { name: 'History' }).click({ timeout: 15000 });

		// At least one outcome badge visible (seeded: 4 outcomes on this contact)
		await expect(
			page
				.getByRole('main')
				.getByText(/Won|Lost|Healthy|At Risk|Missed/)
				.first(),
		).toBeVisible();
	});

	test('Dashboard Past Decisions card shows win rate and Deals breakdown', async ({ page }) => {
		await page.goto('/');

		// Past Decisions heading
		await expect(page.getByRole('heading', { name: 'Past Decisions' }).first()).toBeVisible();

		// Win rate summary line (e.g. "75% win rate across 4 outcomes")
		await expect(page.getByText(/win rate across \d+ outcomes/)).toBeVisible();

		// Deals badge in the per-type breakdown (scoped to main content, exact match)
		await expect(page.getByRole('main').getByText('Deals', { exact: true }).first()).toBeVisible();
	});
});

test.describe('Phase 35 — Auth guard (unauthenticated)', () => {
	test('/contacts/[id] redirects unauthenticated users to /login', async ({ page }) => {
		await page.goto(`/contacts/${CONTACT_ID}`);
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByRole('heading', { name: 'Sign in to Gordian' })).toBeVisible();
	});
});

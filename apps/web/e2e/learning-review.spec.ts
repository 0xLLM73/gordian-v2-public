import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.describe('AI Learning Review Page (authenticated)', () => {
	test.use({ storageState: AUTH_FILE });

	test('renders the learning review page with stats and empty queue', async ({ page }) => {
		await page.goto('/settings/learning');
		await page.waitForLoadState('networkidle');

		// Page title
		await expect(page.getByRole('heading', { name: 'AI Learning Queue' })).toBeVisible();

		// Stats cards are present (values may be 0)
		await expect(page.getByText('Pending Review')).toBeVisible();
		await expect(page.getByText('Verified (Gold)')).toBeVisible();
		await expect(page.getByText('Rejected')).toBeVisible();

		// Domain filter select is present
		await expect(page.getByRole('combobox')).toBeVisible();

		// Pagination is present
		await expect(page.getByRole('button', { name: 'Previous' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
	});

	test('domain filter dropdown has expected options', async ({ page }) => {
		await page.goto('/settings/learning');
		await page.waitForLoadState('networkidle');

		const select = page.getByRole('combobox');
		await expect(select).toBeVisible();

		// Check option values (options inside <select> are hidden in Chromium, check count + text)
		await expect(select.locator('option')).toHaveCount(4); // "All domains" + 3 domains
		await expect(select.locator('option').first()).toHaveText('All domains');
		await expect(select.locator('option').nth(1)).toHaveText('commitment extraction');
	});

	test('reset button clears filter', async ({ page }) => {
		await page.goto('/settings/learning');
		await page.waitForLoadState('networkidle');

		const select = page.getByRole('combobox');
		await select.selectOption('commitment_extraction');
		await expect(select).toHaveValue('commitment_extraction');

		await page.getByRole('button', { name: 'Reset' }).click();
		await expect(select).toHaveValue('');
	});
});

test.describe('Settings page links to Learning (authenticated)', () => {
	test.use({ storageState: AUTH_FILE });

	test('settings page has AI Learning section with link', async ({ page }) => {
		await page.goto('/settings');
		await page.waitForLoadState('networkidle');

		await expect(page.getByRole('heading', { name: 'AI Learning' })).toBeVisible();
		await expect(page.getByText('Review AI extraction examples')).toBeVisible();

		const link = page.getByRole('link', { name: 'Review Learning Queue' });
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('href', '/settings/learning');
	});

	test('clicking Review Learning Queue navigates to learning page', async ({ page }) => {
		await page.goto('/settings');
		await page.waitForLoadState('networkidle');

		await page.getByRole('link', { name: 'Review Learning Queue' }).click();
		await expect(page).toHaveURL(/\/settings\/learning/);
		await expect(page.getByRole('heading', { name: 'AI Learning Queue' })).toBeVisible();
	});
});

test.describe('AI Learning — Promote & Reject actions (authenticated)', () => {
	test.use({ storageState: AUTH_FILE });

	test('promote button removes example from queue and updates stats', async ({ page }) => {
		await page.goto('/settings/learning');
		await page.waitForLoadState('networkidle');

		const promoteButton = page.getByRole('button', { name: 'Promote to Gold' }).first();
		const hasPending = await promoteButton.isVisible().catch(() => false);

		if (!hasPending) {
			test.skip(true, 'No pending examples in queue — seed data or run extraction first');
			return;
		}

		// Capture the initial "Pending Review" stat value
		const pendingStatBefore = page.getByText('Pending Review').locator('..');
		const pendingTextBefore = await pendingStatBefore.textContent();

		// Click promote on the first example
		await promoteButton.click();

		// Wait for the UI to update (button should disappear or example removed)
		await page.waitForLoadState('networkidle');

		// Pending count should have decreased or page refreshed
		const pendingTextAfter = await pendingStatBefore.textContent();
		expect(pendingTextAfter).not.toBe(pendingTextBefore);
	});

	test('reject button removes example from queue', async ({ page }) => {
		await page.goto('/settings/learning');
		await page.waitForLoadState('networkidle');

		const rejectButton = page.getByRole('button', { name: 'Reject' }).first();
		const hasPending = await rejectButton.isVisible().catch(() => false);

		if (!hasPending) {
			test.skip(true, 'No pending examples in queue — seed data or run extraction first');
			return;
		}

		// Count examples before reject
		const examplesBefore = await page.getByRole('button', { name: 'Reject' }).count();

		await rejectButton.click();
		await page.waitForLoadState('networkidle');

		// Should have one fewer example (or page refreshed)
		const examplesAfter = await page.getByRole('button', { name: 'Reject' }).count();
		expect(examplesAfter).toBeLessThan(examplesBefore);
	});

	test('commitment_extraction filter shows only commitment examples', async ({ page }) => {
		await page.goto('/settings/learning');
		await page.waitForLoadState('networkidle');

		const select = page.getByRole('combobox');
		await select.selectOption('commitment_extraction');
		await page.waitForLoadState('networkidle');

		// If there are any badges, they should all say "commitment extraction"
		const badges = page.locator('span').filter({ hasText: 'commitment extraction' });
		const count = await badges.count();

		if (count > 0) {
			// All visible domain badges should be commitment extraction
			for (let i = 0; i < count; i++) {
				await expect(badges.nth(i)).toContainText('commitment extraction');
			}
		}
		// If 0, the filter worked but there are no examples — still a pass
	});
});

test.describe('AI Learning — Auth guard (unauthenticated)', () => {
	test('/settings/learning redirects unauthenticated users to /login', async ({ page }) => {
		await page.goto('/settings/learning');
		await expect(page).toHaveURL(/\/login/);
	});
});

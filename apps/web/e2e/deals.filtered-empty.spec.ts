import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('filtered empty deals state does not claim the pipeline is empty', async ({ page }) => {
	await page.goto('/deals?stage=lost', { waitUntil: 'domcontentloaded' });

	await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
	await expect(page.getByText('No lost deals match this filter.')).toBeVisible();
	await expect(page.getByText(/Your pipeline still has \d+ deals\./)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Clear filter' })).toHaveAttribute('href', '/deals');
	await expect(page.getByText('No deals yet.')).toHaveCount(0);
});

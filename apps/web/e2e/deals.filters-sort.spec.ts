import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('stage filters and sort controls preserve compatible URL state', async ({ page }) => {
	await page.goto('/deals?stage=discovery', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');

	await expect(page.getByTestId('deals-active-filters')).toContainText('Stage: Discovery');
	await expect(page.getByLabel('Sort deals')).toHaveValue('last_activity');
	await page.getByLabel('Sort deals').selectOption('highest_value');
	await expect(page).toHaveURL(/\/deals\?stage=discovery&sort=highest_value$/);
	await page.waitForLoadState('networkidle');

	await expect(page.getByTestId('deals-active-filters')).toContainText('Stage: Discovery');
	await expect(page.getByTestId('deals-active-filters')).toContainText('Sort: Highest value');

	await page
		.getByTestId('deals-active-filters')
		.getByRole('link', { name: 'Sort: Highest value Clear' })
		.click();
	await expect(page).toHaveURL(/\/deals\?stage=discovery$/);
	await page.waitForLoadState('networkidle');

	const stageFilters = page.getByLabel('Filter deals by stage');
	await stageFilters.getByRole('button', { name: 'All' }).click();
	await expect(page).toHaveURL(/\/deals$/);
	await expect(page.getByTestId('deals-active-filters')).toHaveCount(0);
});

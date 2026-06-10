import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { deterministicSeedUuid } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

test('cross-workspace deal detail remains fail-closed on desktop and mobile', async ({ page }) => {
	const bobDealId = deterministicSeedUuid('bob-deal-sol-otc');

	for (const width of [1280, 390, 320]) {
		await page.setViewportSize({ width, height: 900 });
		const response = await page.goto(`/deals/${bobDealId}`, { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(404);
		await expect(page.getByText('404')).toBeVisible();
	}
});

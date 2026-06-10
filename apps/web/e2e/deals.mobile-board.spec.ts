import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

async function expectNoHorizontalPageOverflow(page: import('@playwright/test').Page) {
	const metrics = await page.evaluate(() => ({
		bodyScrollWidth: document.body.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		documentScrollWidth: document.documentElement.scrollWidth,
	}));

	expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
	expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test('mobile board stacks stage columns and avoids page overflow', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto('/deals', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'Board' }).click();
	await expect(page.getByTestId('deals-board')).toBeVisible();
	await expect(page.getByTestId('deals-board-column').first()).toBeVisible();
	await expect(page.locator('select[aria-label^="Move stage for"]').first()).toBeVisible();
	await expectNoHorizontalPageOverflow(page);

	await page.setViewportSize({ width: 320, height: 900 });
	await expectNoHorizontalPageOverflow(page);
});

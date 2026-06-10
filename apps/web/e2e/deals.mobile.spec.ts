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

test('deals list and detail avoid horizontal page overflow on mobile', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto('/deals', { waitUntil: 'domcontentloaded' });

	await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Aptos Series A' })).toBeVisible();
	await expectNoHorizontalPageOverflow(page);

	await page.setViewportSize({ width: 320, height: 900 });
	await expectNoHorizontalPageOverflow(page);

	const firstDealHref = await page.locator('a[href^="/deals/"]').first().getAttribute('href');
	expect(firstDealHref).toBeTruthy();

	await page.goto(firstDealHref ?? '/deals', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('link', { name: 'Back to deals' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Participants' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Artifacts' })).toBeVisible();
	await expectNoHorizontalPageOverflow(page);

	await page.setViewportSize({ width: 390, height: 900 });
	await expectNoHorizontalPageOverflow(page);
});

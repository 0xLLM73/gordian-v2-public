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

test('deal detail cockpit avoids horizontal overflow on mobile', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto('/deals', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	const detailHref = await page.locator('a[href^="/deals/"]').first().getAttribute('href');
	expect(detailHref).toBeTruthy();

	await page.goto(detailHref ?? '/deals', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('deal-overview-panel')).toBeVisible();
	await expect(page.getByTestId('deal-stage-timeline')).toBeVisible();
	await expect(page.getByTestId('deal-decision-trail')).toBeVisible();
	await expect(page.getByTestId('deal-evidence-panel')).toBeVisible();
	await expectNoHorizontalPageOverflow(page);

	await page.setViewportSize({ width: 320, height: 900 });
	await expectNoHorizontalPageOverflow(page);
});

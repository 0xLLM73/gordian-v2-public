import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('deal local AI draft flow stays local and does not mutate Telegram', async ({ page }) => {
	const externalBrowserRequests: string[] = [];
	page.on('request', (request) => {
		const url = request.url();
		if (!url.startsWith('http://localhost:3456') && !url.startsWith('http://127.0.0.1:3456')) {
			externalBrowserRequests.push(url);
		}
	});

	await page.goto('/deals', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	const detailHref = await page
		.getByTestId('deal-row')
		.first()
		.locator('a[href^="/deals/"]')
		.getAttribute('href');
	expect(detailHref).toBeTruthy();
	await page.goto(detailHref ?? '/deals', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');

	const panel = page.getByTestId('deal-local-ai-status');
	await expect(panel).toContainText('Vendor egress: off by default');

	const before = await panel.getByTestId('deal-ai-run').count();
	await panel.getByRole('button', { name: 'Draft follow-up' }).click();
	const newest = panel.getByTestId('deal-ai-run').first();
	await expect
		.poll(async () => panel.getByTestId('deal-ai-run').count(), { timeout: 15000 })
		.toBeGreaterThan(before);
	await expect(newest).toContainText('Follow-up Draft');
	await expect(newest).toContainText('Draft only - not sent');

	expect(externalBrowserRequests).toEqual([]);
	await expect(page.getByText('Message sent')).toHaveCount(0);
});

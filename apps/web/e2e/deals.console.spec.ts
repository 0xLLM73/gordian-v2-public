import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('deals list and board do not emit React key warnings', async ({ page }) => {
	const consoleMessages: string[] = [];
	const pageErrors: string[] = [];

	page.on('console', (message) => {
		if (message.type() === 'warning' || message.type() === 'error') {
			consoleMessages.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		pageErrors.push(error.message);
	});

	await page.goto('/deals', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
	await page.getByRole('button', { name: 'Board' }).click();
	await expect(
		page.getByTestId('deals-kanban-view').getByText('Discovery', { exact: true }),
	).toBeVisible();
	await page.getByRole('button', { name: 'List' }).click();
	await expect(page.getByRole('button', { name: 'Aptos Series A' })).toBeVisible();

	const keyWarnings = consoleMessages.filter((message) =>
		message.includes('Each child in a list should have a unique "key" prop'),
	);

	expect(pageErrors).toEqual([]);
	expect(keyWarnings).toEqual([]);
});

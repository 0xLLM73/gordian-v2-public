import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('board view renders the same filtered deal ids as list view', async ({ page }) => {
	await page.goto('/deals?stage=discovery', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');

	await expect(page.getByTestId('deal-row').first()).toBeVisible();
	const listIds = await page.getByTestId('deal-row').evaluateAll((rows) =>
		rows
			.map((row) => row.getAttribute('data-deal-id'))
			.filter(Boolean)
			.sort(),
	);
	expect(listIds.length).toBeGreaterThan(0);

	await page.getByRole('button', { name: 'Board' }).click();
	await expect(page.getByTestId('deals-kanban-view')).toBeVisible();
	await expect(page.getByTestId('deal-board-card').first()).toBeVisible();

	const boardIds = await page.getByTestId('deal-board-card').evaluateAll((cards) =>
		cards
			.map((card) => card.getAttribute('data-deal-id'))
			.filter(Boolean)
			.sort(),
	);

	expect(boardIds).toEqual(listIds);
	await expect(
		page.getByTestId('deals-board-column').filter({ hasText: 'Discovery' }),
	).toBeVisible();
});

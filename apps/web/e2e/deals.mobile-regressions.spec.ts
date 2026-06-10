import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { expectNoHorizontalOverflow, openDeals, openFirstDeal } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

for (const width of [390, 320]) {
	test(`deals list, board, and detail avoid horizontal overflow at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });

		await openDeals(page);
		await expect(page.getByTestId('deal-row').first()).toBeVisible();
		await expectNoHorizontalOverflow(page);

		await page.getByRole('button', { name: 'Board' }).click();
		await expect(page.getByTestId('deals-board')).toBeVisible();
		await expectNoHorizontalOverflow(page);

		await openFirstDeal(page);
		await expect(page.getByTestId('deal-overview-panel')).toBeVisible();
		await expect(page.getByTestId('deal-local-ai-status')).toBeVisible();
		await expectNoHorizontalOverflow(page);
	});
}

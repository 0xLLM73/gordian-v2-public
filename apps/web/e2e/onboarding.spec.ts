import { expect, test } from '@playwright/test';

test.describe('Onboarding Pages', () => {
	test('disabled Telegram connect page points evaluators to the demo path', async ({ page }) => {
		await page.goto('/onboarding/connect');

		await expect(page.getByRole('heading', { name: 'Telegram linking is disabled' })).toBeVisible();
		await expect(page.getByText('pnpm demo:setup')).toBeVisible();
		await expect(page.getByText('alice@gordian.dev')).toBeVisible();
	});
});

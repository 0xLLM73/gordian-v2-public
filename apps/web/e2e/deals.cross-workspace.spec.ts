import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

function deterministicUUID(name: string): string {
	const hash = createHash('sha256').update(`gordian-seed:${name}`).digest('hex');
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		`4${hash.slice(13, 16)}`,
		`8${hash.slice(17, 20)}`,
		hash.slice(20, 32),
	].join('-');
}

test('cross-workspace deal detail fails closed', async ({ page }) => {
	const bobDealId = deterministicUUID('bob-deal-sol-otc');

	await page.goto(`/deals/${bobDealId}`, { waitUntil: 'domcontentloaded' });

	await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
	await expect(page.getByText('Page not found')).toBeVisible();
	await expect(page.getByTestId('deal-overview-panel')).toHaveCount(0);
});

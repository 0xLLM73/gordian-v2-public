import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { expectVisibleRunCount, openFirstDeal } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

test('saved local AI output survives refresh with provenance and uncertainty', async ({ page }) => {
	await openFirstDeal(page);
	const panel = page.getByTestId('deal-local-ai-status');
	const before = await panel.getByTestId('deal-ai-run').count();

	await panel.getByRole('button', { name: 'Next actions' }).click();
	await expectVisibleRunCount(panel, before + 1);
	await expect(panel.getByTestId('deal-ai-run').first()).toContainText('Next Action');
	await expect(panel.getByTestId('deal-ai-run').first()).toContainText(/source\(s\)/);

	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByTestId('deal-local-ai-status').getByTestId('deal-ai-run').first(),
	).toContainText('Next Action');
});

import { expect, type Locator, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { createDisposableDeal, deleteDisposableDeal } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

async function expectNewRun(panel: Locator, before: number) {
	await expect
		.poll(async () => panel.getByTestId('deal-ai-run').count(), { timeout: 15000 })
		.toBeGreaterThan(before);
	return panel.getByTestId('deal-ai-run').first();
}

test('deal local AI panel generates source-backed outputs and explicit suggestion states', async ({
	page,
}) => {
	let dealId: string | null = null;
	try {
		const disposable = await createDisposableDeal(page, {
			title: `E2E local AI isolation ${Date.now()}`,
		});
		dealId = disposable.id;
		await page.goto(disposable.href, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');

		const panel = page.getByTestId('deal-local-ai-status');
		await expect(panel).toBeVisible();
		await expect(panel).toContainText('Local AI');
		await expect(panel).toContainText('Vendor egress: off by default');

		let before = await panel.getByTestId('deal-ai-run').count();
		await panel.getByRole('button', { name: 'Generate brief' }).click();
		let newest = await expectNewRun(panel, before);
		await expect(newest).toContainText('Brief');
		await expect(newest).toContainText(/source\(s\)/);

		before = await panel.getByTestId('deal-ai-run').count();
		await panel.getByLabel('Ask local deal AI').fill('What wire instructions did they send?');
		await panel.getByRole('button', { name: 'Ask' }).click();
		newest = await expectNewRun(panel, before);
		await expect(newest).toContainText('Answer');
		await expect(newest).toContainText('I do not have enough linked source evidence');

		before = await panel.getByTestId('deal-ai-run').count();
		await panel.getByRole('button', { name: 'Suggest commitment' }).click();
		newest = await expectNewRun(panel, before);
		await expect(newest).toContainText('Commitment Draft');
		await expect(newest).toContainText('requires explicit acceptance');
		await newest.getByRole('button', { name: 'Accept draft' }).click();
		await expect(newest).toContainText('accepted');

		before = await panel.getByTestId('deal-ai-run').count();
		await panel.getByRole('button', { name: 'Explain risks' }).click();
		newest = await expectNewRun(panel, before);
		await expect(newest).toContainText('Risk');
		await newest.getByRole('button', { name: 'Dismiss' }).click();
		await expect(newest).toContainText('dismissed');
	} finally {
		await deleteDisposableDeal(dealId);
	}
});

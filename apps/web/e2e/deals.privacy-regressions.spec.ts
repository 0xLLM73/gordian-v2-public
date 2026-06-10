import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { createDisposableDeal, deleteDisposableDeal } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

test('deal detail keeps artifact metadata encrypted-path UX and source evidence visible', async ({
	page,
}) => {
	let dealId: string | null = null;
	try {
		const disposable = await createDisposableDeal(page, {
			title: `E2E privacy isolation ${Date.now()}`,
		});
		dealId = disposable.id;
		await page.goto(disposable.href, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');

		await expect(page.getByTestId('deal-artifacts-section')).toBeVisible();
		await expect(page.getByTestId('deal-evidence-panel')).toBeVisible();
		await expect(page.getByTestId('deal-decision-trail')).toBeVisible();
		await expect(page.getByTestId('deal-local-ai-status')).toContainText(
			'Vendor egress: off by default',
		);

		const artifacts = page.getByTestId('deal-artifacts-section');
		await artifacts.getByRole('button', { name: '+ Add' }).click();
		const title = `Sensitive Artifact ${Date.now()}`;
		await artifacts.getByLabel('Artifact title').fill(title);
		await artifacts.getByLabel('Artifact URL').fill('https://example.test/private-signed-url');
		await artifacts.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(artifacts).toContainText(title);
	} finally {
		await deleteDisposableDeal(dealId);
	}
});

import { expect, test } from '@playwright/test';
import { db, dealArtifacts, desc, eq } from '@repo/db';
import { AUTH_FILE } from './fixtures/auth';
import { createDisposableDeal, deleteDisposableDeal } from './fixtures/deals';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:5432/gordian_dev';

test.use({ storageState: AUTH_FILE });

test('deal artifact add, persist, and remove flow keeps console clean', async ({ page }) => {
	let dealId: string | null = null;
	const consoleMessages: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'warning' || message.type() === 'error') {
			consoleMessages.push(message.text());
		}
	});

	try {
		const disposable = await createDisposableDeal(page, {
			title: `E2E artifact isolation ${Date.now()}`,
		});
		dealId = disposable.id;

		const title = `Sensitive Artifact ${Date.now()}`;
		const url = `https://example.com/private/${Date.now()}/terms.pdf`;

		await page.goto(disposable.href, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');
		const artifacts = page.getByTestId('deal-artifacts-section');
		await expect(artifacts.getByRole('heading', { name: 'Artifacts' })).toBeVisible();
		await artifacts.getByRole('button', { name: '+ Add' }).click();
		await expect(artifacts.getByPlaceholder('Artifact title')).toBeVisible();
		await artifacts.getByPlaceholder('Artifact title').fill(title);
		await artifacts.getByPlaceholder('URL (optional)').fill(url);
		await artifacts.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(artifacts.getByText(title)).toBeVisible();
		await expect(
			artifacts.getByRole('link', { name: `Open reference for ${title}` }),
		).toBeVisible();

		await page.reload({ waitUntil: 'networkidle' });
		const refreshedArtifacts = page.getByTestId('deal-artifacts-section');
		await expect(refreshedArtifacts.getByText(title)).toBeVisible();
		await expect(
			refreshedArtifacts.getByRole('link', { name: `Open reference for ${title}` }),
		).toBeVisible();

		const rawArtifacts = await db
			.select({
				title: dealArtifacts.title,
				url: dealArtifacts.url,
			})
			.from(dealArtifacts)
			.where(eq(dealArtifacts.dealId, dealId ?? ''))
			.orderBy(desc(dealArtifacts.createdAt))
			.limit(5);

		expect(rawArtifacts.length).toBeGreaterThan(0);
		expect(
			rawArtifacts.some((artifact) => artifact.title === title || artifact.title.includes(title)),
		).toBe(false);
		expect(
			rawArtifacts.some((artifact) => artifact.url === url || artifact.url?.includes(url)),
		).toBe(false);

		const artifactRow = refreshedArtifacts.locator('div.rounded-md').filter({ hasText: title });
		const removeButton = artifactRow.getByRole('button', { name: 'Remove', exact: true });
		await expect(removeButton).toBeEnabled();
		await removeButton.click();
		const confirmDialog = page
			.locator('[role="alertdialog"]')
			.filter({ hasText: 'Remove artifact?' });
		await expect(confirmDialog).toBeVisible();
		await confirmDialog.getByRole('button', { name: 'Remove', exact: true }).click();
		await expect(refreshedArtifacts.getByText(title)).toHaveCount(0);

		expect(consoleMessages.join('\n')).not.toContain(title);
		expect(consoleMessages.join('\n')).not.toContain(url);
	} finally {
		await deleteDisposableDeal(dealId);
	}
});

import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { createDisposableDeal, deleteDisposableDeal } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

test('deals command center shows global totals, filtered counts, and clearable filters', async ({
	page,
}) => {
	await page.goto('/deals?stage=discovery&sort=highest_value', {
		waitUntil: 'domcontentloaded',
	});

	await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
	await expect(page.getByTestId('deals-pipeline-summary')).toContainText(
		/Pipeline total: \d+ deals/,
	);
	await expect(page.getByTestId('deals-result-summary')).toContainText(
		/Showing \d+ of \d+ discovery deals\. Pipeline total: \d+ deals/,
	);
	await expect(page.getByTestId('deals-result-summary')).toContainText('Sorted by highest value.');

	const activeFilters = page.getByTestId('deals-active-filters');
	await expect(activeFilters).toContainText('Stage: Discovery');
	await expect(activeFilters).toContainText('Sort: Highest value');
	await expect(activeFilters.getByRole('link', { name: 'Clear all' })).toHaveAttribute(
		'href',
		'/deals',
	);

	await activeFilters.getByRole('link', { name: 'Clear all' }).click();
	await expect(page).toHaveURL(/\/deals$/);
	await expect(page.getByTestId('deals-active-filters')).toHaveCount(0);
	await expect(page.getByTestId('deal-row').first()).toBeVisible();
});

test('list view exposes keyboard-accessible stage movement and restores the original stage', async ({
	page,
}) => {
	let dealId: string | null = null;
	try {
		const disposable = await createDisposableDeal(page, {
			title: `E2E stage isolation ${Date.now()}`,
		});
		dealId = disposable.id;

		const row = page.locator(`[data-testid="deal-row"][data-deal-id="${dealId}"]`);
		await expect(row).toBeVisible();

		const stageSelect = row.locator('select[aria-label^="Move stage for"]');
		const originalStage = await stageSelect.inputValue();
		const targetStage = originalStage === 'discovery' ? 'diligence' : 'discovery';

		await stageSelect.selectOption(targetStage);
		await expect(stageSelect).toHaveValue(targetStage);

		const restoredRow = page.locator(`[data-testid="deal-row"][data-deal-id="${dealId}"]`);
		await expect(restoredRow).toBeVisible();
		const restoreSelect = restoredRow.locator('select[aria-label^="Move stage for"]');
		await restoreSelect.selectOption(originalStage);
		await expect(restoreSelect).toHaveValue(originalStage);
	} finally {
		await deleteDisposableDeal(dealId);
	}
});

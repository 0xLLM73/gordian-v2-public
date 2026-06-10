import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { openDeals } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

test('deals list keeps baseline sorting, empty-filter, create-form, and console guardrails', async ({
	page,
}) => {
	const consoleMessages: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'warning' || message.type() === 'error') {
			consoleMessages.push(message.text());
		}
	});

	await openDeals(page);
	await expect(page.getByTestId('deal-row')).toHaveCount(4);
	await expect(page.getByRole('button', { name: 'New Deal' })).toBeVisible();

	await page.getByLabel('Sort deals').selectOption('highest_value');
	await expect(page).toHaveURL(/sort=highest_value/);
	await expect(page.getByTestId('deals-result-summary')).toContainText('highest value');

	await openDeals(page, '/deals?stage=won');
	await expect(page.getByTestId('deals-empty-state')).toContainText(
		'No won deals match this filter',
	);
	await expect(page.getByTestId('deals-pipeline-summary')).toBeVisible();

	await page.getByRole('button', { name: 'New Deal' }).click();
	const createButton = page.getByRole('button', { name: 'Create Deal' });
	await expect(createButton).toBeDisabled();

	expect(consoleMessages.filter((text) => !text.includes('webpack.cache'))).toEqual([]);
});

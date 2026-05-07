import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('seeded demo workspace loads core CRM surfaces', async ({ page }) => {
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByText('Act Now')).toBeVisible();
	await expect(page.getByText('New Intel')).toBeVisible();

	await page.goto('/contacts', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
	await expect(page.getByText('Marcus Chen')).toBeVisible();
	await expect(page.getByText('Sarah Mitchell')).toBeVisible();

	await page.goto('/deals', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
	await expect(page.getByText('Aptos Series A')).toBeVisible();
	await expect(page.getByText('MoveProtocol Seed Extension')).toBeVisible();

	await page.goto('/commitments', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Commitments' })).toBeVisible();
	await expect(page.getByText('Wire $2M for Aptos SAFT')).toBeVisible();
	await expect(page.getByText('Schedule deep dive with MoveProtocol')).toBeVisible();

	await page.goto('/goals', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible();

	await page.goto('/knowledge', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
	await expect(page.getByPlaceholder('Search topics, projects, sectors...')).toBeVisible();

	await page.goto('/settings', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	await expect(page.getByText('Telegram linking is disabled for this deployment.')).toBeVisible();
	await expect(
		page.getByText('Morning brief delivery is disabled in this demo build.'),
	).toBeVisible();
	await expect(
		page.getByText('Google Calendar OAuth is not configured in this demo build.'),
	).toBeVisible();
});

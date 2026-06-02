import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('seeded demo workspace loads the dashboard', async ({ page }) => {
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByText('Act Now')).toBeVisible();
	await expect(page.getByText('New Intel')).toBeVisible();
});

test('seeded demo workspace loads contacts', async ({ page }) => {
	await page.goto('/contacts', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
	await expect(page.getByText('Marcus Chen')).toBeVisible();
	await expect(page.getByText('Sarah Mitchell')).toBeVisible();
});

test('seeded demo workspace loads deals', async ({ page }) => {
	await page.goto('/deals', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
	await expect(page.getByText('Aptos Series A')).toBeVisible();
	await expect(page.getByText('MoveProtocol Seed Extension')).toBeVisible();
});

test('seeded demo workspace loads commitments', async ({ page }) => {
	await page.goto('/commitments', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Commitments' })).toBeVisible();
	await expect(page.getByText('Wire $2M for Aptos SAFT')).toBeVisible();
	await expect(page.getByText('Schedule deep dive with MoveProtocol')).toBeVisible();
});

test('seeded demo workspace loads goals', async ({ page }) => {
	await page.goto('/goals', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible();
});

test('seeded demo workspace loads knowledge search', async ({ page }) => {
	await page.goto('/knowledge', { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
	await expect(page.getByPlaceholder('Search topics, projects, communities...')).toBeVisible();
});

test('seeded demo workspace loads safe local settings', async ({ page }) => {
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

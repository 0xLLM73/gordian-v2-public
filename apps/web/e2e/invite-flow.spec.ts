import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.describe('Invite Flow (unauthenticated)', () => {
	test('invalid invite token shows error', async ({ page }) => {
		await page.goto('/invite/00000000-0000-0000-0000-000000000000');

		await expect(page.getByRole('heading', { name: 'Invalid Invite' })).toBeVisible();
		await expect(
			page.getByText('This invite link is invalid or has already been used'),
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
	});

	test('invite page has no sidebar (auth layout)', async ({ page }) => {
		await page.goto('/invite/00000000-0000-0000-0000-000000000000');

		const sidebar = page.locator('aside');
		await expect(sidebar).not.toBeVisible();
	});
});

test.describe('Invite Settings (authenticated)', () => {
	test.use({ storageState: AUTH_FILE });

	test('settings page shows invite section with create button', async ({ page }) => {
		await page.goto('/settings');
		await page.waitForLoadState('networkidle');

		await expect(page.getByText('Invite Members')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create Invite' })).toBeVisible();
	});

	test('create invite form renders with correct fields', async ({ page }) => {
		await page.goto('/settings');
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'Create Invite' }).click();

		// Form fields
		await expect(page.getByLabel('Email (optional)')).toBeVisible();
		await expect(page.getByLabel('Role')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create & copy link' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
	});

	test('cancel closes invite form', async ({ page }) => {
		await page.goto('/settings');
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'Create Invite' }).click();
		await expect(page.getByRole('button', { name: 'Create & copy link' })).toBeVisible();

		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('button', { name: 'Create & copy link' })).not.toBeVisible();
	});
});

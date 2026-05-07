import { expect, test } from '@playwright/test';

test.describe('Auth Pages', () => {
	test('login page renders with correct form fields', async ({ page }) => {
		await page.goto('/login');

		await expect(page.getByRole('heading', { name: 'Sign in to Gordian' })).toBeVisible();
		await expect(page.getByLabel('Email')).toBeVisible();
		await expect(page.getByLabel('Password')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
	});

	test('signup page renders closed message', async ({ page }) => {
		await page.goto('/signup');

		await expect(page.getByRole('heading', { name: 'Sign up is currently closed' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
	});

	test('login page has no sidebar (auth layout)', async ({ page }) => {
		await page.goto('/login');

		// Auth layout should be centered with no navigation sidebar
		const sidebar = page.locator('aside');
		await expect(sidebar).not.toBeVisible();
	});

	test('signup page has no sidebar (auth layout)', async ({ page }) => {
		await page.goto('/signup');

		const sidebar = page.locator('aside');
		await expect(sidebar).not.toBeVisible();
	});

	test('login → signup navigation works', async ({ page }) => {
		await page.goto('/login');

		await page.getByRole('link', { name: 'Sign up' }).click();
		await expect(page).toHaveURL(/\/signup/);
		await expect(page.getByRole('heading', { name: 'Sign up is currently closed' })).toBeVisible();
	});

	test('signup → login navigation works', async ({ page }) => {
		await page.goto('/signup');

		await page.getByRole('link', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByRole('heading', { name: 'Sign in to Gordian' })).toBeVisible();
	});

	test('login form validates required fields', async ({ page }) => {
		await page.goto('/login');

		// Click submit without filling fields — browser validation should prevent
		const emailInput = page.getByLabel('Email');
		await expect(emailInput).toHaveAttribute('required', '');

		const passwordInput = page.getByLabel('Password');
		await expect(passwordInput).toHaveAttribute('required', '');
	});
});

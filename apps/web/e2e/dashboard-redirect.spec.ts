import { expect, test } from '@playwright/test';

test.describe('Dashboard Auth Guard', () => {
	const protectedRoutes = [
		{ path: '/', name: 'Dashboard home' },
		{ path: '/contacts', name: 'Contacts' },
		{ path: '/deals', name: 'Deals' },
		{ path: '/commitments', name: 'Commitments' },
		{ path: '/settings', name: 'Settings' },
		{ path: '/onboarding', name: 'Onboarding redirect' },
	];

	for (const route of protectedRoutes) {
		test(`${route.name} (${route.path}) redirects to /login when unauthenticated`, async ({
			page,
		}) => {
			await page.goto(route.path);

			await expect(page).toHaveURL(/\/login/);
			await expect(page.getByRole('heading', { name: 'Sign in to Gordian' })).toBeVisible();
		});
	}
});

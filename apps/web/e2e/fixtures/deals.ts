import { createHash } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { db, deals, eq } from '@repo/db';

export function deterministicSeedUuid(name: string): string {
	const hash = createHash('sha256').update(`gordian-seed:${name}`).digest('hex');
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		`4${hash.slice(13, 16)}`,
		`8${hash.slice(17, 20)}`,
		hash.slice(20, 32),
	].join('-');
}

export async function openDeals(page: Page, path = '/deals') {
	await page.goto(path, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
}

export async function openFirstDeal(page: Page) {
	await openDeals(page);
	const firstRow = page.getByTestId('deal-row').first();
	await expect(firstRow).toBeVisible();
	const detailHref = await firstRow.locator('a[href^="/deals/"]').getAttribute('href');
	expect(detailHref).toBeTruthy();
	await page.goto(detailHref ?? '/deals', { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('deal-detail-header')).toBeVisible();
	return detailHref ?? '/deals';
}

export async function createDisposableDeal(
	page: Page,
	options?: {
		title?: string;
		contactName?: string;
		value?: string;
		notes?: string;
	},
) {
	const title = options?.title ?? `E2E disposable deal ${Date.now()}`;
	await openDeals(page, '/deals?new=1');

	await page.getByPlaceholder('Deal title').fill(title);
	await page.getByRole('button', { name: 'Select contact...' }).click();
	if (options?.contactName) {
		await page.getByPlaceholder('Search contacts...').fill(options.contactName);
	}
	const contactOption = options?.contactName
		? page.locator('[cmdk-item]').filter({ hasText: options.contactName }).first()
		: page.locator('[cmdk-item]').first();
	await expect(contactOption).toBeVisible();
	await contactOption.click();
	await page.getByPlaceholder('Value (USD)').fill(options?.value ?? '123456');
	await page
		.getByPlaceholder('Notes (optional)')
		.fill(options?.notes ?? 'Temporary deal created by an isolated e2e test.');
	await page.getByRole('button', { name: 'Create Deal' }).click();

	const row = page.getByTestId('deal-row').filter({ hasText: title });
	await expect(row).toBeVisible();
	const href = await row.locator('a[href^="/deals/"]').getAttribute('href');
	expect(href).toBeTruthy();
	const id = href?.split('/').pop();
	expect(id).toBeTruthy();

	return { id: id ?? '', href: href ?? '/deals', title };
}

export async function deleteDisposableDeal(dealId: string | null | undefined) {
	if (!dealId) return;
	await db.delete(deals).where(eq(deals.id, dealId));
}

export async function expectNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
}

export async function expectVisibleRunCount(panel: Locator, minCount: number) {
	await expect
		.poll(async () => panel.getByTestId('deal-ai-run').count(), { timeout: 15000 })
		.toBeGreaterThanOrEqual(minCount);
}

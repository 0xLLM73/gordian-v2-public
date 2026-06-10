import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';
import { createDisposableDeal, deleteDisposableDeal } from './fixtures/deals';

test.use({ storageState: AUTH_FILE });

test('deal detail cockpit supports participant role editing and stage-note timeline events', async ({
	page,
}) => {
	let dealId: string | null = null;
	try {
		const disposable = await createDisposableDeal(page, {
			title: `E2E cockpit isolation ${Date.now()}`,
		});
		dealId = disposable.id;

		await page.goto(disposable.href, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');

		await expect(page.getByTestId('deal-overview-panel')).toBeVisible();
		await expect(page.getByTestId('deal-participants-section')).toBeVisible();
		await expect(page.getByTestId('deal-artifacts-section')).toBeVisible();
		await expect(page.getByTestId('deal-stage-timeline')).toBeVisible();
		await expect(page.getByTestId('deal-decision-trail')).toBeVisible();
		await expect(page.getByTestId('deal-evidence-panel')).toBeVisible();
		const localAiStatus = page.getByTestId('deal-local-ai-status');
		await expect(localAiStatus).toBeVisible();
		await expect(localAiStatus).toContainText('Local AI');
		await expect(localAiStatus).toContainText('Vendor egress: off by default');

		const participants = page.getByTestId('deal-participants-section');
		await participants.getByRole('button', { name: '+ Add' }).click();
		await expect(participants.locator('select').first()).toBeVisible();
		await participants.locator('select').first().selectOption({ index: 1 });
		await participants.locator('select').nth(1).selectOption('advisor');
		await participants.getByRole('button', { name: 'Add', exact: true }).click();
		const roleSelect = participants.locator('select[aria-label^="Change role for"]').first();
		await expect(roleSelect).toBeVisible();
		await roleSelect.selectOption('lead');
		await expect(roleSelect).toHaveValue('lead');

		const stageNote = `Stage note ${Date.now()}`;
		await page.getByRole('button', { name: 'Diligence' }).click();
		await page
			.getByPlaceholder('e.g. Moving to diligence after positive first call')
			.fill(stageNote);
		await page.getByRole('button', { name: 'Confirm' }).click();
		await expect(page.getByTestId('deal-stage-timeline')).toContainText(stageNote);
		await expect(page.getByTestId('deal-stage-timeline')).toContainText('Discovery -> Diligence');
	} finally {
		await deleteDisposableDeal(dealId);
	}
});

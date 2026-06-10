import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './fixtures/auth';

test.use({ storageState: AUTH_FILE });

test('basic CRM export keeps sensitive deal extensions out of the payload', async ({ page }) => {
	const response = await page.request.get('/api/export');
	expect(response.status()).toBe(200);

	const data = await response.json();
	const serialized = JSON.stringify(data);
	expect(data.exportType).toBe('basic_crm');
	expect(data.included).toEqual(['contacts', 'commitments', 'deals']);
	expect(
		data.contacts.every((contact: Record<string, unknown>) => !('sourceAccountId' in contact)),
	).toBe(true);
	expect(
		data.contacts.every((contact: Record<string, unknown>) => !('telegramId' in contact)),
	).toBe(true);
	expect(data.deals.every((deal: Record<string, unknown>) => !('notes' in deal))).toBe(true);
	expect(data.deals.every((deal: Record<string, unknown>) => !('workspaceId' in deal))).toBe(true);
	expect(serialized).not.toContain('deal_ai_runs');
	expect(serialized).not.toContain('sourceManifest');
	expect(serialized).not.toContain('private-signed-url');
	expect(serialized).not.toContain('sourceAccountId');
	expect(serialized).not.toContain('telegramId');
	expect(serialized).not.toContain('Telegram account 1');
	expect(serialized).not.toContain('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
});

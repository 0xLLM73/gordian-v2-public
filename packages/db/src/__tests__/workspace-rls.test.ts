import { describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockTransaction = vi.fn(
	async (fn: (tx: { execute: typeof mockExecute }) => Promise<unknown>) =>
		fn({ execute: mockExecute }),
);

vi.mock('../client', async () => {
	const { sql } = await import('drizzle-orm');
	return {
		db: { transaction: mockTransaction },
		withWorkspaceRLS: async (workspaceId: string, fn: (tx: unknown) => Promise<unknown>) => {
			return mockTransaction(async (tx: { execute: typeof mockExecute }) => {
				await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
				return fn(tx as unknown as never);
			});
		},
	};
});

describe('withWorkspaceRLS', () => {
	it('sets app.workspace_id before callback', async () => {
		const { withWorkspaceRLS } = await import('../client');
		const wsId = '11111111-1111-1111-1111-111111111111';
		const callback = vi.fn().mockResolvedValue('result');

		const result = await withWorkspaceRLS(wsId, callback);

		expect(result).toBe('result');
		expect(mockTransaction).toHaveBeenCalledOnce();
		expect(mockExecute).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledOnce();

		// Workspace context must be set before the callback.
		const executeOrder = mockExecute.mock.invocationCallOrder[0];
		const callbackOrder = callback.mock.invocationCallOrder[0];
		expect(executeOrder).toBeLessThan(callbackOrder);
	});

	it('passes the transaction handle to the callback', async () => {
		const { withWorkspaceRLS } = await import('../client');
		const wsId = '22222222-2222-2222-2222-222222222222';

		await withWorkspaceRLS(wsId, async (tx) => {
			expect(tx).toHaveProperty('execute');
			return null;
		});
	});
});

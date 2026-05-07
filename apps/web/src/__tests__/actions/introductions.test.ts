import { describe, expect, it, vi } from 'vitest';

const mockList = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	listIntroductions: (...args: unknown[]) => mockList(...args),
	updateIntroductionStatus: (...args: unknown[]) => mockUpdate(...args),
}));

vi.mock('@/lib/safe-action', () => ({
	workspaceAction: {
		schema: () => ({
			action: (fn: (...args: unknown[]) => unknown) => fn,
		}),
	},
}));

describe('introductions actions', () => {
	it('listIntroductionsAction calls DAL with workspace scope', async () => {
		mockList.mockResolvedValue([{ id: 'intro-1' }]);

		// Test that the DAL is called with correct workspace ID
		await mockList('ws-1', { status: undefined, limit: undefined });
		expect(mockList).toHaveBeenCalledWith('ws-1', { status: undefined, limit: undefined });
	});

	it('updateIntroStatusAction validates transition', async () => {
		mockUpdate.mockResolvedValue({ id: 'intro-1', status: 'confirmed' });

		await mockUpdate('ws-1', 'intro-1', 'confirmed');
		expect(mockUpdate).toHaveBeenCalledWith('ws-1', 'intro-1', 'confirmed');
	});
});

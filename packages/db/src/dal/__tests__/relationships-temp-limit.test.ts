import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn(async () => [{ id: 'rel-1' }]));
const mockWithPostgresTempFileLimit = vi.hoisted(() =>
	vi.fn(async (_context: string, fn: (tx: { execute: typeof mockExecute }) => Promise<unknown>) =>
		fn({ execute: mockExecute }),
	),
);

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../client', () => ({
	db: {
		execute: mockExecute,
	},
	withPostgresTempFileLimit: mockWithPostgresTempFileLimit,
}));

import { deriveGroupChatRelationships } from '../relationships';

describe('deriveGroupChatRelationships temp-file guard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs group relationship derivation through the Postgres temp-file limit wrapper', async () => {
		const count = await deriveGroupChatRelationships('00000000-0000-0000-0000-000000000001', {
			contactId: '00000000-0000-0000-0000-000000000002',
		});

		expect(count).toBe(1);
		expect(mockWithPostgresTempFileLimit).toHaveBeenCalledWith(
			'deriveGroupChatRelationships',
			expect.any(Function),
		);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});
});

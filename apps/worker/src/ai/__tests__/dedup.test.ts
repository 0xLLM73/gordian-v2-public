import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute } = vi.hoisted(() => ({
	mockExecute: vi.fn(),
}));

vi.mock('@repo/db', () => ({
	db: { execute: mockExecute },
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		text: strings.reduce(
			(acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''),
			'',
		),
	}),
}));

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const CONTACT_ID = '00000000-0000-0000-0000-000000000002';

function embedding(dimensions: number): number[] {
	return Array.from({ length: dimensions }, (_, index) => index / 1000);
}

function executedSql(index: number): string {
	return (mockExecute.mock.calls[index]?.[0] as { text?: string } | undefined)?.text ?? '';
}

describe('deduplicateCommitment', () => {
	beforeEach(() => {
		mockExecute.mockReset();
	});

	it('casts commitment similarity checks as halfvec(512) for 512-dim embeddings', async () => {
		mockExecute.mockResolvedValueOnce([]);

		const { deduplicateCommitment } = await import('../dedup');
		const result = await deduplicateCommitment(
			WORKSPACE_ID,
			CONTACT_ID,
			'Send deck',
			embedding(512),
		);

		expect(result).toBe('create');
		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(executedSql(0)).toContain('::halfvec(512)');
		expect(executedSql(0)).not.toContain('::halfvec(1536)');
		expect(executedSql(0)).not.toContain('user_decisions');
	});

	it('preserves 1536-dim user_decisions dismissal checks when full graph embeddings are supplied', async () => {
		mockExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'decision-1' }]);

		const { deduplicateCommitment } = await import('../dedup');
		const result = await deduplicateCommitment(
			WORKSPACE_ID,
			CONTACT_ID,
			'Send deck',
			embedding(1536),
		);

		expect(result).toBe('dismiss');
		expect(mockExecute).toHaveBeenCalledTimes(2);
		expect(executedSql(0)).toContain('::halfvec(512)');
		expect(executedSql(1)).toContain('user_decisions');
		expect(executedSql(1)).toContain('::vector(1536)');
	});

	it('does not run decision-graph casts after a semantic merge', async () => {
		mockExecute.mockResolvedValueOnce([{ similarity: 0.91 }]);

		const { deduplicateCommitment } = await import('../dedup');
		const result = await deduplicateCommitment(
			WORKSPACE_ID,
			CONTACT_ID,
			'Send deck',
			embedding(512),
		);

		expect(result).toBe('merge');
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('skips dedup safely for malformed short embeddings', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { deduplicateCommitment } = await import('../dedup');
		const result = await deduplicateCommitment(
			WORKSPACE_ID,
			CONTACT_ID,
			'Send deck',
			embedding(128),
		);

		expect(result).toBe('create');
		expect(mockExecute).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('expected at least 512 dimensions'));

		warn.mockRestore();
	});
});

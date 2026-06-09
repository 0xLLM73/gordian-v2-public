import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('correction diff embedding schema', () => {
	it('stores mistake embeddings as halfvec(512)', async () => {
		const { correctionDiffs } = await import('../schema/correction-diffs');

		expect(correctionDiffs.mistakeEmbedding.getSQLType()).toBe('halfvec(512)');
	});

	it('migrates correction diff mistake embeddings to the 512-dimension halfvec standard', () => {
		const migration = readFileSync(
			join(__dirname, '..', '..', 'drizzle', '0063_correction_diff_embedding_512.sql'),
			'utf8',
		);

		expect(migration).toContain('ALTER COLUMN mistake_embedding TYPE halfvec(512)');
		expect(migration).toContain('USING mistake_embedding::halfvec(512)');
		expect(migration).toContain('mistake_embedding halfvec_cosine_ops');
		expect(migration).not.toContain('mistake_embedding vector_cosine_ops');
	});
});

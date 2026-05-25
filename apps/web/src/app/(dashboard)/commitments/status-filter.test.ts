import { describe, expect, it } from 'vitest';
import { COMMITMENT_STATUS_FILTERS, normalizeCommitmentStatusFilter } from './status-filter';

describe('commitment status filters', () => {
	it('accepts every supported commitment status filter', () => {
		for (const status of COMMITMENT_STATUS_FILTERS) {
			expect(normalizeCommitmentStatusFilter(status)).toBe(status);
		}
	});

	it('falls back to all for missing or unsupported filters', () => {
		expect(normalizeCommitmentStatusFilter(undefined)).toBe('all');
		expect(normalizeCommitmentStatusFilter('')).toBe('all');
		expect(normalizeCommitmentStatusFilter('archived')).toBe('all');
		expect(normalizeCommitmentStatusFilter('active;drop')).toBe('all');
	});
});

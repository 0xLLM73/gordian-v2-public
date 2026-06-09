import { describe, expect, it } from 'vitest';
import { COMMITMENT_STATUS_FILTERS, normalizeCommitmentStatusFilter } from './status-filter';

describe('commitment status filters', () => {
	it('accepts every supported commitment status filter', () => {
		for (const status of COMMITMENT_STATUS_FILTERS) {
			expect(normalizeCommitmentStatusFilter(status)).toBe(status);
		}
	});

	it('falls back to active commitments for missing or unsupported filters', () => {
		expect(normalizeCommitmentStatusFilter(undefined)).toBe('active');
		expect(normalizeCommitmentStatusFilter('')).toBe('active');
		expect(normalizeCommitmentStatusFilter('archived')).toBe('active');
		expect(normalizeCommitmentStatusFilter('active;drop')).toBe('active');
	});
});

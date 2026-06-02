import { describe, expect, it } from 'vitest';
import {
	DEAL_SORT_FILTERS,
	DEAL_STAGE_FILTERS,
	normalizeDealSortFilter,
	normalizeDealStageFilter,
} from './filter-options';

describe('deal filters', () => {
	it('accepts supported stage and sort filters', () => {
		for (const stage of DEAL_STAGE_FILTERS) {
			expect(normalizeDealStageFilter(stage)).toBe(stage);
		}
		for (const sort of DEAL_SORT_FILTERS) {
			expect(normalizeDealSortFilter(sort)).toBe(sort);
		}
	});

	it('falls back to route defaults for unsupported values', () => {
		expect(normalizeDealStageFilter(undefined)).toBe('all');
		expect(normalizeDealStageFilter('active')).toBe('all');
		expect(normalizeDealStageFilter('discovery;drop')).toBe('all');
		expect(normalizeDealSortFilter(undefined)).toBe('last_activity');
		expect(normalizeDealSortFilter('highest_value;drop')).toBe('last_activity');
	});
});

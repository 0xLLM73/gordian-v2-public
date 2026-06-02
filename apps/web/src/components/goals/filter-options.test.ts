import { describe, expect, it } from 'vitest';
import {
	GOAL_SORT_FILTERS,
	GOAL_STATUS_FILTERS,
	GOAL_TYPE_FILTERS,
	normalizeGoalSortFilter,
	normalizeGoalStatusFilter,
	normalizeGoalTypeFilter,
} from './filter-options';

describe('goal filters', () => {
	it('accepts supported status, type, and sort filters', () => {
		for (const status of GOAL_STATUS_FILTERS) {
			expect(normalizeGoalStatusFilter(status)).toBe(status);
		}
		for (const type of GOAL_TYPE_FILTERS) {
			expect(normalizeGoalTypeFilter(type)).toBe(type);
		}
		for (const sort of GOAL_SORT_FILTERS) {
			expect(normalizeGoalSortFilter(sort)).toBe(sort);
		}
	});

	it('falls back to route defaults for unsupported values', () => {
		expect(normalizeGoalStatusFilter(undefined)).toBe('active');
		expect(normalizeGoalStatusFilter('draft')).toBe('active');
		expect(normalizeGoalStatusFilter('active;drop')).toBe('active');
		expect(normalizeGoalTypeFilter(undefined)).toBe('all');
		expect(normalizeGoalTypeFilter('token')).toBe('all');
		expect(normalizeGoalSortFilter(undefined)).toBe('newest');
		expect(normalizeGoalSortFilter('highest_value')).toBe('newest');
	});
});

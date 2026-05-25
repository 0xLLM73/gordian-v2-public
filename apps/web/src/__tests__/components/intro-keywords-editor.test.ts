import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/preferences', () => ({
	updatePreferencesAction: vi.fn(),
}));

import {
	MAX_CUSTOM_INTRO_KEYWORDS,
	getIntroKeywordValidationError,
	normalizeIntroKeyword,
	normalizeIntroKeywords,
} from '@/components/settings/intro-keywords-editor';

describe('intro keyword editor helpers', () => {
	it('normalizes keyword casing and whitespace', () => {
		expect(normalizeIntroKeyword('  Warm   Intro  ')).toBe('warm intro');
	});

	it('deduplicates custom keywords and removes built-ins', () => {
		expect(normalizeIntroKeywords(['Alpha', 'alpha', ' introduce ', '', '  Beta  Fund '])).toEqual([
			'alpha',
			'beta fund',
		]);
	});

	it('returns validation messages for duplicate and built-in keywords', () => {
		expect(getIntroKeywordValidationError('alpha', ['alpha'])).toBe(
			'This custom keyword already exists.',
		);
		expect(getIntroKeywordValidationError('introduce', [])).toBe(
			'This keyword is already built in.',
		);
	});

	it('rejects multiline keywords and custom keyword overflow', () => {
		expect(getIntroKeywordValidationError('warm\nintro', [])).toBe(
			'Use one keyword or phrase per entry.',
		);

		const fullKeywordList = Array.from(
			{ length: MAX_CUSTOM_INTRO_KEYWORDS },
			(_, index) => `keyword ${index}`,
		);
		expect(getIntroKeywordValidationError('another keyword', fullKeywordList)).toBe(
			`You can add up to ${MAX_CUSTOM_INTRO_KEYWORDS} custom keywords.`,
		);
	});
});

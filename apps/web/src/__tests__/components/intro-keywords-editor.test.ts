import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/preferences', () => ({
	updatePreferencesAction: vi.fn(),
}));

import { updatePreferencesAction } from '@/app/actions/preferences';
import {
	BUILT_IN_KEYWORDS,
	BUILT_IN_NEW_CONNECTION_KEYWORDS,
	IntroKeywordsEditor,
	MAX_CUSTOM_INTRO_KEYWORDS,
	getDetectionKeywordValidationError,
	getIntroKeywordValidationError,
	normalizeDetectionKeywords,
	normalizeIntroKeyword,
	normalizeIntroKeywords,
	prepareDetectionKeywordsForSave,
} from '@/components/settings/intro-keywords-editor';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.stubGlobal('React', React);

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

	it('normalizes connection keywords against the connection built-ins', () => {
		expect(
			normalizeDetectionKeywords(
				['First IRL', 'first  irl', ' event ', '  warm handshake  '],
				BUILT_IN_NEW_CONNECTION_KEYWORDS,
			),
		).toEqual(['first irl', 'warm handshake']);
	});

	it('returns validation messages for duplicate and built-in keywords', () => {
		expect(getIntroKeywordValidationError('alpha', ['alpha'])).toBe(
			'This custom keyword already exists.',
		);
		expect(getIntroKeywordValidationError('introduce', [])).toBe(
			'This keyword is already built in.',
		);
		expect(
			getDetectionKeywordValidationError('new connection', [], BUILT_IN_NEW_CONNECTION_KEYWORDS),
		).toBe('This keyword is already built in.');
	});

	it('includes a valid pending input value when saving', () => {
		expect(prepareDetectionKeywordsForSave([], ' connect   with ', BUILT_IN_KEYWORDS)).toEqual({
			keywords: ['connect with'],
			error: null,
			shouldClearInput: true,
		});
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

describe('IntroKeywordsEditor', () => {
	it('saves a valid pending input value without requiring Add first', async () => {
		vi.mocked(updatePreferencesAction).mockResolvedValueOnce({
			data: {
				timezone: 'UTC',
				briefEnabled: true,
				briefTime: 7,
				briefDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
				digestFocus: 'balanced',
				introKeywords: ['connect with'],
				connectionKeywords: [],
				ghostingAlertStatuses: ['cooling', 'dormant'],
				ghostingStaleDays: 30,
			},
		});

		render(React.createElement(IntroKeywordsEditor, { currentKeywords: [] }));

		fireEvent.change(screen.getByPlaceholderText('Add a keyword...'), {
			target: { value: 'connect with' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => {
			expect(updatePreferencesAction).toHaveBeenCalledWith({
				introKeywords: ['connect with'],
			});
		});
		await waitFor(() => {
			expect(screen.getByText('connect with')).toBeTruthy();
		});
		expect(screen.getByPlaceholderText('Add a keyword...')).toHaveProperty('value', '');
	});
});

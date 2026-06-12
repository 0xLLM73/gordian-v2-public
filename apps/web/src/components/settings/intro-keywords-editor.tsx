'use client';

import { BUILT_IN_CONNECTION_KEYWORDS, BUILT_IN_INTRO_KEYWORDS } from '@repo/shared';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { updatePreferencesAction } from '@/app/actions/preferences';

export const MAX_CUSTOM_INTRO_KEYWORDS = 20;
export const MAX_INTRO_KEYWORD_LENGTH = 50;

export const BUILT_IN_KEYWORDS = [...BUILT_IN_INTRO_KEYWORDS];
export const BUILT_IN_NEW_CONNECTION_KEYWORDS = [...BUILT_IN_CONNECTION_KEYWORDS];

type DetectionKeywordPreferenceKey = 'introKeywords' | 'connectionKeywords';

interface DetectionKeywordsEditorProps {
	currentKeywords: string[];
	builtInKeywords: readonly string[];
	preferenceKey: DetectionKeywordPreferenceKey;
	title?: string;
	description?: string;
	customLabel?: string;
}

interface IntroKeywordsEditorProps {
	currentKeywords: string[];
	title?: string;
	description?: string;
}

export function normalizeDetectionKeyword(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeDetectionKeywords(
	values: string[],
	builtInKeywords: readonly string[],
): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	const builtInSet = new Set(builtInKeywords.map((keyword) => normalizeDetectionKeyword(keyword)));

	for (const rawValue of values) {
		const keyword = normalizeDetectionKeyword(rawValue);
		if (!keyword || seen.has(keyword) || builtInSet.has(keyword)) continue;
		seen.add(keyword);
		normalized.push(keyword);
		if (normalized.length >= MAX_CUSTOM_INTRO_KEYWORDS) break;
	}

	return normalized;
}

export function getDetectionKeywordValidationError(
	value: string,
	keywords: string[],
	builtInKeywords: readonly string[],
): string | null {
	const normalized = normalizeDetectionKeyword(value);
	const builtInSet = new Set(builtInKeywords.map((keyword) => normalizeDetectionKeyword(keyword)));
	if (!normalized) return 'Enter a keyword.';
	if (/[\r\n\t]/.test(value)) return 'Use one keyword or phrase per entry.';
	if (normalized.length > MAX_INTRO_KEYWORD_LENGTH) {
		return `Keywords must be ${MAX_INTRO_KEYWORD_LENGTH} characters or fewer.`;
	}
	if (builtInSet.has(normalized)) return 'This keyword is already built in.';
	if (keywords.includes(normalized)) return 'This custom keyword already exists.';
	if (keywords.length >= MAX_CUSTOM_INTRO_KEYWORDS) {
		return `You can add up to ${MAX_CUSTOM_INTRO_KEYWORDS} custom keywords.`;
	}
	return null;
}

export function normalizeIntroKeyword(value: string): string {
	return normalizeDetectionKeyword(value);
}

export function normalizeIntroKeywords(values: string[]): string[] {
	return normalizeDetectionKeywords(values, BUILT_IN_KEYWORDS);
}

export function getIntroKeywordValidationError(value: string, keywords: string[]): string | null {
	return getDetectionKeywordValidationError(value, keywords, BUILT_IN_KEYWORDS);
}

export function prepareDetectionKeywordsForSave(
	keywords: string[],
	pendingValue: string,
	builtInKeywords: readonly string[],
): { keywords: string[]; error: string | null; shouldClearInput: boolean } {
	const normalized = normalizeDetectionKeywords(keywords, builtInKeywords);
	if (!pendingValue.trim()) {
		return { keywords: normalized, error: null, shouldClearInput: false };
	}

	const validationError = getDetectionKeywordValidationError(
		pendingValue,
		normalized,
		builtInKeywords,
	);
	if (validationError) {
		return { keywords: normalized, error: validationError, shouldClearInput: false };
	}

	const withPending = normalizeDetectionKeywords(
		[...normalized, normalizeDetectionKeyword(pendingValue)],
		builtInKeywords,
	);
	return { keywords: withPending, error: null, shouldClearInput: true };
}

export function IntroKeywordsEditor({
	currentKeywords,
	title,
	description,
}: IntroKeywordsEditorProps) {
	return (
		<DetectionKeywordsEditor
			currentKeywords={currentKeywords}
			builtInKeywords={BUILT_IN_KEYWORDS}
			preferenceKey="introKeywords"
			title={title}
			description={description}
			customLabel="Custom introduction keywords"
		/>
	);
}

export function ConnectionKeywordsEditor({
	currentKeywords,
	title,
	description,
}: IntroKeywordsEditorProps) {
	return (
		<DetectionKeywordsEditor
			currentKeywords={currentKeywords}
			builtInKeywords={BUILT_IN_NEW_CONNECTION_KEYWORDS}
			preferenceKey="connectionKeywords"
			title={title}
			description={description}
			customLabel="Custom new-connection keywords"
		/>
	);
}

export function DetectionKeywordsEditor({
	currentKeywords,
	builtInKeywords,
	preferenceKey,
	title,
	description,
	customLabel = 'Custom keywords',
}: DetectionKeywordsEditorProps) {
	const errorId = useId();
	const [keywords, setKeywords] = useState<string[]>(() =>
		normalizeDetectionKeywords(currentKeywords, builtInKeywords),
	);
	const [inputValue, setInputValue] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const [saved, setSaved] = useState(false);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		setKeywords(normalizeDetectionKeywords(currentKeywords, builtInKeywords));
	}, [currentKeywords, builtInKeywords]);

	useEffect(
		() => () => {
			if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
		},
		[],
	);

	function showSaved() {
		setSaved(true);
		if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
		savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
	}

	function addKeyword() {
		const normalized = normalizeDetectionKeyword(inputValue);
		const validationError = getDetectionKeywordValidationError(
			inputValue,
			keywords,
			builtInKeywords,
		);
		if (validationError) {
			setError(validationError);
			setSaved(false);
			return;
		}

		setKeywords([...keywords, normalized]);
		setInputValue('');
		setError(null);
		setSaved(false);
	}

	function removeKeyword(kw: string) {
		setKeywords(keywords.filter((k) => k !== kw));
		setError(null);
		setSaved(false);
	}

	function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addKeyword();
		}
	}

	function handleSave() {
		startTransition(async () => {
			const prepared = prepareDetectionKeywordsForSave(keywords, inputValue, builtInKeywords);
			if (prepared.error) {
				setKeywords(prepared.keywords);
				setError(prepared.error);
				setSaved(false);
				return;
			}
			const normalized = prepared.keywords;
			setKeywords(normalized);
			setError(null);
			try {
				const result = await updatePreferencesAction(
					preferenceKey === 'introKeywords'
						? { introKeywords: normalized }
						: { connectionKeywords: normalized },
				);
				const saveError = getSaveError(result);
				if (saveError) {
					setError(saveError);
					setSaved(false);
					return;
				}
				if (prepared.shouldClearInput) setInputValue('');
				showSaved();
			} catch {
				setError('Unable to save keywords. Try again.');
				setSaved(false);
			}
		});
	}

	return (
		<div className="space-y-4" data-testid={`detection-keywords-${preferenceKey}`}>
			{title || description ? (
				<div>
					{title ? <h3 className="text-sm font-semibold text-foreground">{title}</h3> : null}
					{description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
				</div>
			) : null}

			<div>
				<p className="mb-2 text-xs font-medium text-muted-foreground">
					Built-in keywords (always active)
				</p>
				<div className="flex flex-wrap gap-1.5">
					{builtInKeywords.map((kw) => (
						<span
							key={kw}
							className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
						>
							{kw}
						</span>
					))}
				</div>
			</div>

			<div>
				<p className="mb-2 text-xs font-medium text-foreground">
					{customLabel} ({keywords.length}/{MAX_CUSTOM_INTRO_KEYWORDS})
				</p>
				<div className="flex flex-wrap gap-1.5">
					{keywords.map((kw) => (
						<span
							key={kw}
							className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-foreground"
						>
							{kw}
							<button
								type="button"
								onClick={() => removeKeyword(kw)}
								className="ml-0.5 text-muted-foreground hover:text-foreground"
								aria-label={`Remove ${kw}`}
							>
								&times;
							</button>
						</span>
					))}
				</div>
			</div>

			<div className="flex gap-2">
				<input
					type="text"
					value={inputValue}
					onChange={(e) => {
						setInputValue(e.target.value);
						if (error) setError(null);
						if (saved) setSaved(false);
					}}
					onKeyDown={handleKeyDown}
					placeholder="Add a keyword..."
					maxLength={MAX_INTRO_KEYWORD_LENGTH}
					disabled={keywords.length >= MAX_CUSTOM_INTRO_KEYWORDS}
					aria-invalid={Boolean(error)}
					aria-describedby={error ? errorId : undefined}
					className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
				/>
				<button
					type="button"
					onClick={addKeyword}
					disabled={!inputValue.trim() || keywords.length >= MAX_CUSTOM_INTRO_KEYWORDS}
					className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
				>
					Add
				</button>
			</div>

			{error ? (
				<p id={errorId} role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={handleSave}
					disabled={isPending}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
				>
					{isPending ? 'Saving...' : 'Save'}
				</button>
				{saved ? <span className="text-sm text-green-600">Saved</span> : null}
			</div>
		</div>
	);
}

function getSaveError(result: unknown): string | null {
	if (!result || typeof result !== 'object') return null;
	if ('serverError' in result && typeof result.serverError === 'string') {
		return result.serverError;
	}
	if ('validationErrors' in result && result.validationErrors) {
		return 'Unable to save keywords. Check the entries and try again.';
	}
	return null;
}

'use client';

import { updatePreferencesAction } from '@/app/actions/preferences';
import { useEffect, useRef, useState, useTransition } from 'react';

export const MAX_CUSTOM_INTRO_KEYWORDS = 20;
export const MAX_INTRO_KEYWORD_LENGTH = 50;

/** Built-in keywords (always active, shown as read-only reference) */
export const BUILT_IN_KEYWORDS = [
	'introduce',
	'meet',
	'connect',
	'adding',
	'cc',
	'forwarded',
	'reach out',
	'in touch',
	'put you in',
	'loop in',
];

const BUILT_IN_KEYWORD_SET = new Set(BUILT_IN_KEYWORDS);

interface Props {
	currentKeywords: string[];
}

export function normalizeIntroKeyword(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeIntroKeywords(values: string[]): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();

	for (const rawValue of values) {
		const keyword = normalizeIntroKeyword(rawValue);
		if (!keyword || seen.has(keyword) || BUILT_IN_KEYWORD_SET.has(keyword)) continue;
		seen.add(keyword);
		normalized.push(keyword);
		if (normalized.length >= MAX_CUSTOM_INTRO_KEYWORDS) break;
	}

	return normalized;
}

export function getIntroKeywordValidationError(value: string, keywords: string[]): string | null {
	const normalized = normalizeIntroKeyword(value);
	if (!normalized) return 'Enter a keyword.';
	if (/[\r\n\t]/.test(value)) return 'Use one keyword or phrase per entry.';
	if (normalized.length > MAX_INTRO_KEYWORD_LENGTH) {
		return `Keywords must be ${MAX_INTRO_KEYWORD_LENGTH} characters or fewer.`;
	}
	if (BUILT_IN_KEYWORD_SET.has(normalized)) return 'This keyword is already built in.';
	if (keywords.includes(normalized)) return 'This custom keyword already exists.';
	if (keywords.length >= MAX_CUSTOM_INTRO_KEYWORDS) {
		return `You can add up to ${MAX_CUSTOM_INTRO_KEYWORDS} custom keywords.`;
	}
	return null;
}

export function IntroKeywordsEditor({ currentKeywords }: Props) {
	const [keywords, setKeywords] = useState<string[]>(() => normalizeIntroKeywords(currentKeywords));
	const [inputValue, setInputValue] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const [saved, setSaved] = useState(false);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		setKeywords(normalizeIntroKeywords(currentKeywords));
	}, [currentKeywords]);

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
		const normalized = normalizeIntroKeyword(inputValue);
		const validationError = getIntroKeywordValidationError(inputValue, keywords);
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

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addKeyword();
		}
	}

	function handleSave() {
		startTransition(async () => {
			const normalized = normalizeIntroKeywords(keywords);
			setKeywords(normalized);
			setError(null);
			try {
				const result = await updatePreferencesAction({ introKeywords: normalized });
				const saveError = getSaveError(result);
				if (saveError) {
					setError(saveError);
					setSaved(false);
					return;
				}
				showSaved();
			} catch {
				setError('Unable to save keywords. Try again.');
				setSaved(false);
			}
		});
	}

	return (
		<div className="space-y-4">
			<div>
				<p className="mb-2 text-xs font-medium text-muted-foreground">
					Built-in keywords (always active)
				</p>
				<div className="flex flex-wrap gap-1.5">
					{BUILT_IN_KEYWORDS.map((kw) => (
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
					Custom keywords ({keywords.length}/{MAX_CUSTOM_INTRO_KEYWORDS})
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
					aria-describedby={error ? 'intro-keyword-error' : undefined}
					className="flex-1 rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
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
				<p id="intro-keyword-error" role="alert" className="text-sm text-destructive">
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

'use client';

import { updatePreferencesAction } from '@/app/actions/preferences';
import { useEffect, useRef, useState, useTransition } from 'react';

/** Built-in keywords (always active, shown as read-only reference) */
const BUILT_IN_KEYWORDS = [
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

interface Props {
	currentKeywords: string[];
}

export function IntroKeywordsEditor({ currentKeywords }: Props) {
	const [keywords, setKeywords] = useState<string[]>(currentKeywords);
	const [inputValue, setInputValue] = useState('');
	const [isPending, startTransition] = useTransition();
	const [saved, setSaved] = useState(false);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
		const trimmed = inputValue.trim().toLowerCase();
		if (!trimmed || keywords.length >= 20) return;
		if (keywords.includes(trimmed) || BUILT_IN_KEYWORDS.includes(trimmed)) return;
		setKeywords([...keywords, trimmed]);
		setInputValue('');
	}

	function removeKeyword(kw: string) {
		setKeywords(keywords.filter((k) => k !== kw));
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addKeyword();
		}
	}

	function handleSave() {
		startTransition(async () => {
			await updatePreferencesAction({ introKeywords: keywords });
			showSaved();
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
					Custom keywords ({keywords.length}/20)
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
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Add a keyword..."
					maxLength={50}
					disabled={keywords.length >= 20}
					className="flex-1 rounded-md border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
				/>
				<button
					type="button"
					onClick={addKeyword}
					disabled={!inputValue.trim() || keywords.length >= 20}
					className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
				>
					Add
				</button>
			</div>

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

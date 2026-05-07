'use client';

import { searchContactsAction } from '@/app/actions/contacts';
import Link from 'next/link';
import { useState, useTransition } from 'react';

export function ContactSearch() {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
	const [isPending, startTransition] = useTransition();

	function handleSearch(value: string) {
		setQuery(value);
		if (value.length < 2) {
			setResults(null);
			return;
		}

		startTransition(async () => {
			const result = await searchContactsAction({
				query: value,
				field: 'name',
			});
			if (result?.data) {
				setResults(result.data as Record<string, unknown>[]);
			}
		});
	}

	return (
		<div className="relative">
			<input
				type="search"
				placeholder="Search contacts..."
				value={query}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
				className="w-full rounded-lg border border-border px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			/>
			{isPending && (
				<div className="absolute right-3 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-border border-t-blue-600" />
			)}
			{results && results.length > 0 && (
				<div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg">
					{results.map((contact) => (
						<Link
							key={contact.id as string}
							href={`/contacts/${contact.id}`}
							className="block px-4 py-2 text-sm hover:bg-accent"
							onClick={() => {
								setResults(null);
								setQuery('');
							}}
						>
							{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown'}
						</Link>
					))}
				</div>
			)}
		</div>
	);
}

'use client';
import { listGoalsAction } from '@/app/actions/goals';
import { listKnowledgeNodesAction } from '@/app/actions/knowledge';
import { searchAction } from '@/app/actions/search';
import { GOAL_STATUS_COLORS, KNOWLEDGE_TYPE_COLORS } from '@/lib/colors';
import type { KnowledgeNodePublic } from '@repo/db';
import Link from 'next/link';
import { useState, useTransition } from 'react';

interface SearchResults {
	contacts: Array<Record<string, unknown>>;
	memories: Array<{ id: string; content: string; category: string; rrf_score: number }>;
	commitments: Array<Record<string, unknown>>;
	deals: Array<Record<string, unknown>>;
	knowledge: KnowledgeNodePublic[];
	goals: Array<Record<string, unknown>>;
}

type TabKey = 'all' | 'contacts' | 'memories' | 'commitments' | 'deals' | 'knowledge' | 'goals';

export function SearchInterface() {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SearchResults | null>(null);
	const [activeTab, setActiveTab] = useState<TabKey>('all');
	const [isPending, startTransition] = useTransition();

	function handleSearch(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!query.trim()) return;

		const q = query.trim().toLowerCase();
		startTransition(async () => {
			const [searchResult, knowledgeResult, goalsResult] = await Promise.all([
				searchAction({ query: query.trim() }),
				listKnowledgeNodesAction({ query: query.trim(), limit: 20, offset: 0 }),
				listGoalsAction({ limit: 100 }),
			]);
			const allGoals = (goalsResult?.data as Array<Record<string, unknown>>) ?? [];
			const matchedGoals = allGoals.filter((g) =>
				((g.title as string) || '').toLowerCase().includes(q),
			);
			if (searchResult?.data) {
				setResults({
					...searchResult.data,
					knowledge: (knowledgeResult?.data as KnowledgeNodePublic[]) ?? [],
					goals: matchedGoals,
				});
			}
		});
	}

	const totalResults = results
		? results.contacts.length +
			results.memories.length +
			results.commitments.length +
			results.deals.length +
			results.knowledge.length +
			results.goals.length
		: 0;

	const tabs: Array<{ key: TabKey; label: string; count: number }> = results
		? [
				{ key: 'all', label: 'All', count: totalResults },
				{ key: 'contacts', label: 'Contacts', count: results.contacts.length },
				{ key: 'memories', label: 'Memories', count: results.memories.length },
				{ key: 'commitments', label: 'Commitments', count: results.commitments.length },
				{ key: 'deals', label: 'Deals', count: results.deals.length },
				{ key: 'goals', label: 'Goals', count: results.goals.length },
				{ key: 'knowledge', label: 'Knowledge', count: results.knowledge.length },
			]
		: [];

	return (
		<div>
			<form onSubmit={handleSearch} className="mb-6">
				<div className="relative">
					<svg
						aria-hidden="true"
						className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={1.5}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
						/>
					</svg>
					<input
						type="text"
						value={query}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
						placeholder="Search contacts, memories, commitments, deals, goals..."
						className="w-full rounded-lg border border-border py-2 pl-10 pr-4 focus:border-blue-500 focus:outline-none"
					/>
				</div>
			</form>

			{isPending ? (
				<div className="py-8 text-center text-sm text-muted-foreground">Searching...</div>
			) : null}

			{results && !isPending ? (
				<div>
					<div className="mb-4 flex gap-2 border-b border-border">
						{tabs.map((tab) => (
							<button
								key={tab.key}
								type="button"
								onClick={() => setActiveTab(tab.key)}
								className={`px-3 py-2 text-sm font-medium ${
									activeTab === tab.key
										? 'border-b-2 border-primary text-primary'
										: 'text-muted-foreground hover:text-foreground'
								}`}
							>
								{tab.label} ({tab.count})
							</button>
						))}
					</div>

					{totalResults === 0 ? (
						<div className="rounded-lg border border-border bg-muted p-8 text-center text-sm text-muted-foreground">
							No results found. Contact search requires exact names.
						</div>
					) : (
						<div className="space-y-3">
							{(activeTab === 'all' || activeTab === 'contacts') && results.contacts.length > 0 ? (
								<ResultSection title="Contacts">
									{results.contacts.map((c) => (
										<Link
											key={c.id as string}
											href={`/contacts/${c.id}`}
											className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent"
										>
											<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
												{((c.firstName as string) || '?')[0].toUpperCase()}
											</div>
											<div>
												<p className="font-medium text-foreground">
													{[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown'}
												</p>
												<p className="text-sm text-muted-foreground">
													{(c.phone as string) || (c.email as string) || 'No contact info'}
												</p>
											</div>
										</Link>
									))}
								</ResultSection>
							) : null}

							{(activeTab === 'all' || activeTab === 'memories') && results.memories.length > 0 ? (
								<ResultSection title="Memories">
									{results.memories.map((m) => (
										<div key={m.id} className="rounded-lg border border-border p-3">
											<div className="mb-1 flex items-center gap-2">
												<span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
													{m.category}
												</span>
												<span className="text-xs text-muted-foreground">
													score: {m.rrf_score.toFixed(3)}
												</span>
											</div>
											<p className="text-sm text-foreground">{m.content}</p>
										</div>
									))}
								</ResultSection>
							) : null}

							{(activeTab === 'all' || activeTab === 'commitments') &&
							results.commitments.length > 0 ? (
								<ResultSection title="Commitments">
									{results.commitments.map((c) => (
										<div key={c.id as string} className="rounded-lg border border-border p-3">
											<p className="font-medium text-foreground">{c.title as string}</p>
											<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
												<span className="rounded bg-muted px-2 py-0.5">{c.status as string}</span>
												<span>{c.commitmentType as string}</span>
											</div>
										</div>
									))}
								</ResultSection>
							) : null}

							{(activeTab === 'all' || activeTab === 'deals') && results.deals.length > 0 ? (
								<ResultSection title="Deals">
									{results.deals.map((d) => (
										<div key={d.id as string} className="rounded-lg border border-border p-3">
											<p className="font-medium text-foreground">{d.title as string}</p>
											<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
												<span className="rounded bg-green-100 px-2 py-0.5 text-green-700">
													{d.status as string}
												</span>
												{d.value ? (
													<span>${((d.value as number) / 100).toLocaleString()}</span>
												) : null}
											</div>
										</div>
									))}
								</ResultSection>
							) : null}

							{(activeTab === 'all' || activeTab === 'goals') && results.goals.length > 0 ? (
								<ResultSection title="Goals">
									{results.goals.map((g) => (
										<div key={g.id as string} className="rounded-lg border border-border p-3">
											<p className="font-medium text-foreground">{g.title as string}</p>
											<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
												<span
													className={`rounded px-2 py-0.5 font-medium ${GOAL_STATUS_COLORS[(g.status as string) || 'active'] || 'bg-gray-100 text-gray-500'}`}
												>
													{g.status as string}
												</span>
												<span>{g.type as string}</span>
												{g.currentCount != null && g.targetCount != null ? (
													<span>
														{g.currentCount as number}/{g.targetCount as number}
													</span>
												) : null}
											</div>
										</div>
									))}
								</ResultSection>
							) : null}

							{(activeTab === 'all' || activeTab === 'knowledge') &&
							results.knowledge.length > 0 ? (
								<ResultSection title="Knowledge">
									{results.knowledge.map((node) => (
										<Link
											key={node.id}
											href={`/knowledge/${node.id}`}
											className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent"
										>
											<span
												className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${KNOWLEDGE_TYPE_COLORS[node.type] || 'bg-gray-100 text-gray-700'}`}
											>
												{node.type}
											</span>
											<div className="min-w-0 flex-1">
												<p className="truncate font-medium text-foreground">{node.displayName}</p>
												{node.description ? (
													<p className="truncate text-sm text-muted-foreground">
														{node.description}
													</p>
												) : null}
											</div>
											<span className="shrink-0 text-xs text-muted-foreground">
												{node.mentionCount ?? 0} mentions
											</span>
										</Link>
									))}
								</ResultSection>
							) : null}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div>
			<h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
			<div className="space-y-2">{children}</div>
		</div>
	);
}

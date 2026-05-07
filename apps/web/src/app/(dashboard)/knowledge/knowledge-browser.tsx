'use client';

// Client boundary: type filter tabs + debounced search input, calls server action on change

import { listKnowledgeNodesAction } from '@/app/actions/knowledge';
import { KnowledgeGraph } from '@/components/knowledge/knowledge-graph';
import { Skeleton } from '@/components/ui/skeleton';
import { sortByRelevance } from '@/lib/knowledge-utils';
import type { KnowledgeNodePublic } from '@repo/db';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

type NodeType = 'topic' | 'project' | 'organization' | 'technology' | 'sector' | 'concept';

const TYPE_TABS: Array<{ key: NodeType | 'all'; label: string }> = [
	{ key: 'all', label: 'All' },
	{ key: 'topic', label: 'Topics' },
	{ key: 'project', label: 'Projects' },
	{ key: 'organization', label: 'Organizations' },
	{ key: 'technology', label: 'Technologies' },
	{ key: 'sector', label: 'Sectors' },
	{ key: 'concept', label: 'Concepts' },
];

const TYPE_COLORS: Record<NodeType, string> = {
	topic: 'bg-blue-100 text-blue-700',
	project: 'bg-indigo-100 text-indigo-700',
	organization: 'bg-green-100 text-green-700',
	technology: 'bg-purple-100 text-purple-700',
	sector: 'bg-orange-100 text-orange-700',
	concept: 'bg-gray-100 text-gray-700',
};

interface EnrichedNode extends KnowledgeNodePublic {
	contactCount?: number;
	contactPreviews?: string[];
}

export function KnowledgeBrowser({ initialNodes }: { initialNodes: EnrichedNode[] }) {
	const [nodes, setNodes] = useState<EnrichedNode[]>(initialNodes);
	const [activeType, setActiveType] = useState<NodeType | 'all'>('all');
	const [query, setQuery] = useState('');
	const [viewMode, setViewMode] = useState<'grid' | 'graph'>('grid');
	const [isPending, startTransition] = useTransition();
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	function fetchNodes(type: NodeType | 'all', q: string) {
		startTransition(async () => {
			const result = await listKnowledgeNodesAction({
				type: type === 'all' ? undefined : type,
				query: q.trim() || undefined,
				limit: 50,
				offset: 0,
			});
			if (result?.data) setNodes(result.data as EnrichedNode[]);
		});
	}

	function handleTypeChange(type: NodeType | 'all') {
		setActiveType(type);
		fetchNodes(type, query);
	}

	function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
		const q = e.target.value;
		setQuery(q);

		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			fetchNodes(activeType, q);
		}, 300);
	}

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	const isSearchActive = query.trim().length > 0;

	return (
		<div>
			{/* View toggle + type filter tabs */}
			<div className="mb-4 flex items-center justify-between overflow-x-auto border-b border-border">
				<nav className="-mb-px flex gap-4 whitespace-nowrap">
					{TYPE_TABS.map((tab) => (
						<button
							key={tab.key}
							type="button"
							onClick={() => handleTypeChange(tab.key)}
							disabled={viewMode === 'graph'}
							className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
								activeType === tab.key && viewMode === 'grid'
									? 'border-indigo-600 text-indigo-600'
									: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-50'
							}`}
						>
							{tab.label}
						</button>
					))}
				</nav>

				<div className="flex gap-1 pb-2">
					<button
						type="button"
						onClick={() => setViewMode('grid')}
						className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
							viewMode === 'grid'
								? 'bg-indigo-100 text-indigo-700'
								: 'text-muted-foreground hover:bg-muted'
						}`}
					>
						Grid
					</button>
					<button
						type="button"
						onClick={() => setViewMode('graph')}
						className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
							viewMode === 'graph'
								? 'bg-indigo-100 text-indigo-700'
								: 'text-muted-foreground hover:bg-muted'
						}`}
					>
						Graph
					</button>
				</div>
			</div>

			{viewMode === 'graph' ? (
				<KnowledgeGraph />
			) : (
				<>
					{/* Search — P2: honest placeholder */}
					<div className="relative mb-6">
						<svg
							aria-hidden="true"
							className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
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
							onChange={handleQueryChange}
							placeholder="Search topics, projects, sectors..."
							className="w-full rounded-lg border border-border py-2 pl-9 pr-4 text-sm focus:border-indigo-500 focus:outline-none"
						/>
					</div>

					{/* Grid — P3: skeleton loading */}
					{isPending ? (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{[1, 2, 3, 4, 5, 6].map((i) => (
								<div key={i} className="rounded-lg border border-border bg-card p-4">
									<div className="mb-2 flex items-center gap-2">
										<Skeleton className="h-5 w-16" />
									</div>
									<Skeleton className="h-5 w-3/4" />
									<Skeleton className="mt-2 h-4 w-full" />
									<div className="mt-3 flex items-center gap-3">
										<Skeleton className="h-3 w-20" />
										<Skeleton className="h-3 w-24" />
									</div>
								</div>
							))}
						</div>
					) : nodes.length === 0 ? (
						<div className="rounded-lg border border-border bg-muted p-8 text-center">
							{isSearchActive ? (
								<>
									<p className="text-sm text-muted-foreground">
										No results for &ldquo;{query}&rdquo;.
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										Try another topic name or use the filters.
									</p>
								</>
							) : (
								<p className="text-sm text-muted-foreground">
									No knowledge nodes found. Sync messages to extract knowledge from your
									conversations.
								</p>
							)}
						</div>
					) : (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{sortByRelevance(nodes).map((node) => (
								<KnowledgeCard key={node.id} node={node} />
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

function KnowledgeCard({ node }: { node: EnrichedNode & { opacity: number } }) {
	const contactCount = node.contactCount ?? 0;
	const previews = node.contactPreviews ?? [];

	return (
		<Link
			href={`/knowledge/${node.id}`}
			className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-border hover:bg-accent"
			style={{ opacity: node.opacity }}
		>
			<div className="mb-2 flex items-center gap-2">
				<span
					className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[node.type as NodeType] || 'bg-gray-100 text-gray-700'}`}
				>
					{node.type}
				</span>
			</div>
			<p className="font-medium text-foreground">{node.displayName}</p>
			{node.description ? (
				<p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{node.description}</p>
			) : null}
			<div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
				<span>{node.mentionCount ?? 0} mentions</span>
				{contactCount > 0 ? (
					<span>
						{previews.join(', ')}
						{contactCount > 3 ? ` + ${contactCount - 3} more` : ''}
					</span>
				) : null}
			</div>
		</Link>
	);
}

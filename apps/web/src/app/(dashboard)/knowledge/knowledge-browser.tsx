'use client';

// Client boundary: type filter tabs + debounced search input, calls server action on change

import { CheckCircle2, CircleHelp, Loader2, Network, Pencil, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import React, { useRef, useState, useTransition } from 'react';
import {
	createManualKnowledgeNodeAction,
	getKnowledgeAnalysisEstimateAction,
	getKnowledgeAnalysisProgressAction,
	getKnowledgeRelationshipExplanationsAction,
	listKnowledgeNodesAction,
	reviewKnowledgeNodeAction,
	runLocalKnowledgeAnalysisAction,
	runLocalKnowledgeInferenceAction,
	searchKnowledgeNodesWithEvidenceAction,
} from '@/app/actions/knowledge';
import { KnowledgeGraph } from '@/components/knowledge/knowledge-graph';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeDate } from '@/lib/format';
import { sortByRelevance } from '@/lib/knowledge-utils';

type NodeType = 'topic' | 'project' | 'organization' | 'technology' | 'sector' | 'concept';
type AnalysisMode = 'incremental' | 'evidence' | 'full';
type ReviewStatus = 'reviewed' | 'needs_review';

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

const ANALYSIS_MODES: Array<{
	key: AnalysisMode;
	label: string;
	description: string;
}> = [
	{
		key: 'incremental',
		label: 'Incremental',
		description: 'New or changed nodes',
	},
	{
		key: 'evidence',
		label: 'Evidence pass',
		description: 'Source rows and contacts',
	},
	{
		key: 'full',
		label: 'Full rebuild',
		description: 'All imported contacts',
	},
];

interface KnowledgeAnalysisEstimate {
	mode?: AnalysisMode;
	enabled?: boolean;
	hasConsent?: boolean;
	canRun?: boolean;
	contactsEstimated?: number;
	staleContactsEstimated?: number;
	backfillContactsEstimated?: number;
	backfillContactsCompletedEstimated?: number;
	backfillMessagesScannedEstimated?: number;
	messagesEstimated?: number;
	embeddingRequestsEstimated?: number;
	embeddingInputsEstimated?: number;
	embeddingProviderMode?: 'cloud' | 'local';
	embeddingProviderLabel?: string;
	llmRequestsEstimated?: number;
	llmProviderMode?: 'cloud' | 'local' | 'disabled';
	llmProviderLabel?: string;
	error?: string;
}

interface KnowledgeMessageCoverage {
	totalMessages: number;
	messagesWithSenderMetadata: number;
	messagesWithUserSenderMetadata: number;
	nullContactMessages: number;
	nullContactMessagesWithSenderMetadata: number;
	nullContactMessagesWithUserSenderMetadata: number;
	linkedContactMessages: number;
	chatsWithNullContactMessages: number;
}

interface KnowledgeAnalysisProgress {
	stage?: 'queued' | 'contacts' | 'llm' | 'complete';
	percent?: number;
	processedContacts?: number;
	expectedContacts?: number;
	llmCompleted?: number;
	expectedLlmRequests?: number;
	entitiesExtracted?: number;
	backfillContactsCompleted?: number;
	backfillContactsInProgress?: number;
	backfillMessagesScanned?: number;
	nodeCount?: number;
	evidenceCount?: number;
	linkCount?: number;
	latestUpdateAt?: string | null;
	complete?: boolean;
	error?: string;
}

interface KnowledgeInferenceRunResult {
	status?: string;
	nodesProcessed?: number;
	coOccurrenceLinks?: number;
	similarityLinks?: number;
	totalLinks?: number;
	skippedReason?: string | null;
	error?: string;
}

interface KnowledgeAnalysisRunResult {
	contactsProcessed?: number;
	embeddingMatches?: number;
	llmQueued?: number;
	batchLinked?: number;
	batchUsed?: boolean;
	elapsedMs?: number;
}

interface ManualKnowledgeEvidenceRunResult {
	contactsScanned?: number;
	messagesScanned?: number;
	evidenceCreated?: number;
	contactsLinked?: number;
	totalEvidenceRows?: number;
	totalEvidenceContacts?: number;
	totalEvidenceMessages?: number;
	skippedReason?: string;
}

interface ManualKnowledgeNodeResult {
	created?: boolean;
	buildQueued?: boolean;
	buildStatus?: string;
	analysis?: KnowledgeAnalysisRunResult;
	manualEvidence?: ManualKnowledgeEvidenceRunResult;
	inference?: KnowledgeInferenceRunResult;
	buildError?: string;
	error?: string;
	node?: EnrichedNode;
}

interface KnowledgeSearchAnswer {
	title: string;
	summary: string;
	support: string[];
	suggestedAction: string;
}

interface EnrichedNode {
	id: string;
	type: string;
	name: string;
	displayName: string;
	description?: string | null;
	mentionCount: number | null;
	firstSeenAt?: Date | string | null;
	lastSeenAt: Date | string | null;
	createdAt?: Date | string | null;
	reviewStatus?: ReviewStatus | null;
	reviewedAt?: string | null;
	contactCount?: number;
	contactPreviews?: string[];
	matchScore?: number | null;
	similarity?: number | null;
	matchReasons?: string[];
	messageRecallScore?: number | null;
	messageHitCount?: number;
	messageMatchedEvidenceIds?: string[];
	messageMatchedAt?: Date | string | null;
	messageRecallReasons?: string[];
	evidenceCount?: number;
	distinctEvidenceMessages?: number;
	distinctEvidenceContacts?: number;
	aggregateEvidenceCount?: number;
	directEvidenceRows?: number;
	directEvidenceMessages?: number;
	directEvidenceContacts?: number;
	possibleEvidenceRows?: number;
	weakEvidenceRows?: number;
	latestEvidenceAt?: Date | string | null;
	topConfidence?: number | null;
	connectedContactCount?: number;
	connectedContactsWithEvidence?: number;
	contacts?: SearchContactPreview[];
	evidence?: SearchEvidencePreview[];
	opacity?: number;
}

interface RelationshipExplanation {
	id: string;
	direction: 'outbound' | 'inbound';
	linkType: string;
	weight?: number | null;
	neighbor: EnrichedNode;
	explanation: string;
	evidence: SearchEvidencePreview[];
}

interface SearchEvidencePreview {
	id: string;
	contactId?: string | null;
	messageId?: string | null;
	relationType: string;
	evidenceKind: string;
	claimLabel: string;
	confidence?: number | null;
	snippet?: string | null;
	occurredAt?: Date | string | null;
	createdAt?: Date | string | null;
}

interface SearchContactPreview {
	id: string;
	firstName?: string | null;
	lastName?: string | null;
	relationType: string;
	strength: number;
	evidenceCount: number;
	lastEvidenceAt?: Date | string | null;
	evidence: SearchEvidencePreview[];
}

function analysisLimitForMode(mode: AnalysisMode): number {
	return mode === 'full' ? 500 : 50;
}

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
	compactDisplay: 'short',
	maximumFractionDigits: 1,
	notation: 'compact',
});

function formatCompactCount(value: number | undefined): string {
	return compactNumberFormatter.format(value ?? 0);
}

function formatCoveragePercent(part: number | undefined, total: number | undefined): string {
	if (!total || total <= 0) return '0%';
	return `${Math.round(((part ?? 0) / total) * 100)}%`;
}

export function KnowledgeBrowser({
	initialNodes,
	messageCoverage,
}: {
	initialNodes: EnrichedNode[];
	messageCoverage?: KnowledgeMessageCoverage;
}) {
	const [nodes, setNodes] = useState<EnrichedNode[]>(initialNodes);
	const [activeType, setActiveType] = useState<NodeType | 'all'>('all');
	const [query, setQuery] = useState('');
	const [normalizedQuery, setNormalizedQuery] = useState('');
	const [noConfidentResults, setNoConfidentResults] = useState(false);
	const [searchAnswer, setSearchAnswer] = useState<KnowledgeSearchAnswer | null>(null);
	const [viewMode, setViewMode] = useState<'grid' | 'graph'>('grid');
	const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('incremental');
	const [analysisEstimate, setAnalysisEstimate] = useState<KnowledgeAnalysisEstimate | null>(null);
	const [analysisError, setAnalysisError] = useState<string | null>(null);
	const [analysisRequest, setAnalysisRequest] = useState<{
		mode: AnalysisMode;
		requestedAt: Date;
		expectedContacts: number;
		expectedLlmRequests: number;
	} | null>(null);
	const [analysisProgress, setAnalysisProgress] = useState<KnowledgeAnalysisProgress | null>(null);
	const [inferenceResult, setInferenceResult] = useState<KnowledgeInferenceRunResult | null>(null);
	const [inferenceError, setInferenceError] = useState<string | null>(null);
	const [manualType, setManualType] = useState<NodeType>('topic');
	const [manualName, setManualName] = useState('');
	const [manualDescription, setManualDescription] = useState('');
	const [manualResult, setManualResult] = useState<ManualKnowledgeNodeResult | null>(null);
	const [manualError, setManualError] = useState<string | null>(null);
	const [manualBuildStage, setManualBuildStage] = useState<
		'idle' | 'creating' | 'complete' | 'error'
	>('idle');
	const [isAnalysisQueued, setIsAnalysisQueued] = useState(false);
	const [isInferenceRunning, setIsInferenceRunning] = useState(false);
	const [isManualCreateRunning, setIsManualCreateRunning] = useState(false);
	const [isSearchPending, setIsSearchPending] = useState(false);
	const [isAnalysisPending, startAnalysisTransition] = useTransition();
	const [isInferencePending, startInferenceTransition] = useTransition();
	const [isManualPending, startManualTransition] = useTransition();
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fetchRequestRef = useRef(0);
	const activeTypeRef = useRef(activeType);
	const queryRef = useRef(query);

	React.useEffect(() => {
		activeTypeRef.current = activeType;
		queryRef.current = query;
	}, [activeType, query]);

	function fetchNodes(type: NodeType | 'all', q: string) {
		const requestId = fetchRequestRef.current + 1;
		fetchRequestRef.current = requestId;
		setIsSearchPending(true);
		void (async () => {
			const trimmedQuery = q.trim();
			try {
				if (trimmedQuery) {
					const result = await searchKnowledgeNodesWithEvidenceAction({
						type: type === 'all' ? undefined : type,
						query: trimmedQuery,
						limit: 50,
					});
					if (fetchRequestRef.current !== requestId) return;
					if (result?.data) {
						setNormalizedQuery(result.data.normalizedQuery);
						setNoConfidentResults(result.data.noConfidentResults);
						setSearchAnswer(result.data.answer ?? null);
						setNodes(
							result.data.results.map((resultNode) => ({
								...resultNode.node,
								reviewStatus: coerceReviewStatus(resultNode.node.reviewStatus),
								matchScore: resultNode.matchScore,
								similarity: resultNode.similarity,
								matchReasons: resultNode.matchReasons,
								messageRecallScore: resultNode.messageRecallScore,
								messageHitCount: resultNode.messageHitCount,
								messageMatchedEvidenceIds: resultNode.messageMatchedEvidenceIds,
								messageMatchedAt: resultNode.messageMatchedAt,
								messageRecallReasons: resultNode.messageRecallReasons,
								evidenceCount: resultNode.evidenceCount,
								aggregateEvidenceCount: resultNode.aggregateEvidenceCount,
								directEvidenceRows: resultNode.directEvidenceRows,
								directEvidenceMessages: resultNode.directEvidenceMessages,
								directEvidenceContacts: resultNode.directEvidenceContacts,
								possibleEvidenceRows: resultNode.possibleEvidenceRows,
								weakEvidenceRows: resultNode.weakEvidenceRows,
								latestEvidenceAt: resultNode.latestEvidenceAt,
								topConfidence: resultNode.topConfidence,
								connectedContactCount: resultNode.connectedContactCount,
								connectedContactsWithEvidence: resultNode.connectedContactsWithEvidence,
								contacts: resultNode.contacts,
								evidence: resultNode.evidence,
							})),
						);
					}
					return;
				}

				setNormalizedQuery('');
				setNoConfidentResults(false);
				setSearchAnswer(null);
				const result = await listKnowledgeNodesAction({
					type: type === 'all' ? undefined : type,
					limit: 50,
					offset: 0,
				});
				if (fetchRequestRef.current !== requestId) return;
				if (result?.data) setNodes((result.data as EnrichedNode[]).map(normalizeEnrichedNode));
			} finally {
				if (fetchRequestRef.current === requestId) setIsSearchPending(false);
			}
		})();
	}
	const fetchNodesRef = useRef(fetchNodes);
	fetchNodesRef.current = fetchNodes;

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

	function handleRunAnalysis() {
		startAnalysisTransition(async () => {
			const requestedAt = new Date();
			const expectedContacts = analysisEstimate?.contactsEstimated ?? 0;
			const expectedLlmRequests = analysisEstimate?.llmRequestsEstimated ?? 0;
			setIsAnalysisQueued(true);
			setAnalysisError(null);
			setAnalysisProgress({
				stage: 'queued',
				percent: 0,
				processedContacts: 0,
				expectedContacts,
				llmCompleted: 0,
				expectedLlmRequests,
				entitiesExtracted: 0,
				backfillContactsCompleted: 0,
				backfillContactsInProgress: 0,
				backfillMessagesScanned: analysisEstimate?.backfillMessagesScannedEstimated ?? 0,
				nodeCount: nodes.length,
				evidenceCount: 0,
				linkCount: 0,
				latestUpdateAt: null,
				complete: false,
			});
			const limit = analysisLimitForMode(analysisMode);
			const result = await runLocalKnowledgeAnalysisAction({
				mode: analysisMode,
				limit,
			});
			if (result?.data?.queued) {
				setAnalysisRequest({
					mode: analysisMode,
					requestedAt,
					expectedContacts,
					expectedLlmRequests,
				});
				const estimate = await getKnowledgeAnalysisEstimateAction({
					mode: analysisMode,
					limit,
				});
				if (estimate?.data) setAnalysisEstimate(estimate.data as KnowledgeAnalysisEstimate);
			} else {
				setAnalysisError(
					(result?.data as { error?: string } | undefined)?.error ?? 'Unable to queue analysis',
				);
				setAnalysisProgress(null);
			}
			setIsAnalysisQueued(false);
		});
	}

	function handleBuildRelationships() {
		startInferenceTransition(async () => {
			setIsInferenceRunning(true);
			setInferenceError(null);
			const result = await runLocalKnowledgeInferenceAction({});
			if (result?.data && !result.data.error) {
				setInferenceResult(result.data as KnowledgeInferenceRunResult);
			} else {
				const error =
					(result?.data as KnowledgeInferenceRunResult | undefined)?.error ??
					'Unable to build relationships';
				setInferenceError(error);
			}
			setIsInferenceRunning(false);
		});
	}

	function handleCreateManualNode() {
		const name = manualName.trim();
		if (!name) {
			setManualError('Name is required');
			setManualBuildStage('error');
			return;
		}
		startManualTransition(async () => {
			const requestedAt = new Date();
			setIsManualCreateRunning(true);
			setManualError(null);
			setManualBuildStage('creating');
			const result = await createManualKnowledgeNodeAction({
				type: manualType,
				name,
				description: manualDescription.trim() || undefined,
				buildNow: true,
			});
			if (result?.data?.created && result.data.node) {
				const node = normalizeEnrichedNode(result.data.node as EnrichedNode);
				setManualResult(result.data as ManualKnowledgeNodeResult);
				setNodes((current) => [node, ...current.filter((item) => item.id !== node.id)]);
				setManualName('');
				setManualDescription('');
				setManualBuildStage('complete');
				if (result.data.buildQueued) {
					const estimate = await getKnowledgeAnalysisEstimateAction({
						mode: 'evidence',
						limit: 500,
					});
					const expectedContacts =
						(estimate?.data as KnowledgeAnalysisEstimate | undefined)?.contactsEstimated ?? 0;
					const expectedLlmRequests =
						(estimate?.data as KnowledgeAnalysisEstimate | undefined)?.llmRequestsEstimated ?? 0;
					if (estimate?.data) setAnalysisEstimate(estimate.data as KnowledgeAnalysisEstimate);
					setAnalysisProgress({
						stage: 'queued',
						percent: 0,
						processedContacts: 0,
						expectedContacts,
						llmCompleted: 0,
						expectedLlmRequests,
						entitiesExtracted: 0,
						nodeCount: nodes.length + 1,
						evidenceCount: 1,
						linkCount: 0,
						latestUpdateAt: null,
						complete: false,
					});
					setAnalysisRequest({
						mode: 'evidence',
						requestedAt,
						expectedContacts,
						expectedLlmRequests,
					});
				}
			} else {
				setManualError(
					(result?.data as ManualKnowledgeNodeResult | undefined)?.error ??
						'Unable to create knowledge node',
				);
				setManualBuildStage('error');
			}
			setIsManualCreateRunning(false);
		});
	}

	function handleNodeUpdated(node: EnrichedNode) {
		const updatedNode = normalizeEnrichedNode(node);
		setNodes((current) =>
			current.map((item) => (item.id === updatedNode.id ? { ...item, ...updatedNode } : item)),
		);
	}

	React.useEffect(() => {
		let cancelled = false;
		startAnalysisTransition(async () => {
			setAnalysisError(null);
			const result = await getKnowledgeAnalysisEstimateAction({
				mode: analysisMode,
				limit: analysisLimitForMode(analysisMode),
			});
			if (cancelled) return;
			if (result?.data) {
				const estimate = result.data as KnowledgeAnalysisEstimate;
				setAnalysisEstimate(estimate);
				setAnalysisError(estimate.error ?? null);
			} else {
				setAnalysisError('Unable to load analysis estimate');
			}
		});
		return () => {
			cancelled = true;
		};
	}, [analysisMode]);

	React.useEffect(() => {
		if (!analysisRequest) return;
		const request = analysisRequest;
		let cancelled = false;
		let intervalId: number | null = null;
		const startedAt = request.requestedAt.toISOString();

		async function pollProgress() {
			const result = await getKnowledgeAnalysisProgressAction({
				mode: request.mode,
				startedAt,
				expectedContacts: request.expectedContacts,
				expectedLlmRequests: request.expectedLlmRequests,
			});
			if (cancelled || !result?.data) return;

			const progress = result.data as KnowledgeAnalysisProgress;
			setAnalysisProgress(progress);

			if (progress.complete || progress.nodeCount) {
				fetchNodesRef.current(activeTypeRef.current, queryRef.current);
			}
			if (progress.complete && intervalId) {
				window.clearInterval(intervalId);
				intervalId = null;
			}
		}

		void pollProgress();
		intervalId = window.setInterval(() => {
			void pollProgress();
		}, 4000);

		return () => {
			cancelled = true;
			if (intervalId) window.clearInterval(intervalId);
		};
	}, [analysisRequest]);

	// Cleanup debounce on unmount
	React.useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	const isSearchActive = query.trim().length > 0;
	const selectedAnalysisMode =
		ANALYSIS_MODES.find((item) => item.key === analysisMode) ?? ANALYSIS_MODES[0];

	return (
		<div>
			<LocalKnowledgeAnalysisPanel
				nodes={nodes}
				mode={analysisMode}
				selectedMode={selectedAnalysisMode}
				estimate={analysisEstimate}
				error={analysisError}
				onModeChange={setAnalysisMode}
				onRunAnalysis={handleRunAnalysis}
				onBuildRelationships={handleBuildRelationships}
				isQueued={isAnalysisQueued || isAnalysisPending}
				isInferenceRunning={isInferenceRunning || isInferencePending}
				lastRequest={analysisRequest}
				progress={analysisProgress}
				inferenceResult={inferenceResult}
				inferenceError={inferenceError}
				messageCoverage={messageCoverage}
			/>
			<ManualKnowledgeNodePanel
				type={manualType}
				name={manualName}
				description={manualDescription}
				result={manualResult}
				error={manualError}
				stage={manualBuildStage}
				isPending={isManualCreateRunning || isManualPending}
				onTypeChange={setManualType}
				onNameChange={setManualName}
				onDescriptionChange={setManualDescription}
				onCreate={handleCreateManualNode}
			/>

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

			{/* Search */}
			<div className="relative mb-4">
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
					placeholder="Search topics, projects, communities..."
					className="w-full rounded-lg border border-border py-2 pl-9 pr-4 text-sm focus:border-indigo-500 focus:outline-none"
				/>
			</div>

			{isSearchActive && normalizedQuery && normalizedQuery !== query.trim() ? (
				<p className="mb-4 text-xs text-muted-foreground">
					Searching for &ldquo;{normalizedQuery}&rdquo;
				</p>
			) : null}

			{viewMode === 'graph' ? (
				<>
					{isSearchActive ? (
						<div className="mb-4 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
							Search results include message evidence matches. Graph mode may show the broader topic
							graph.
						</div>
					) : null}
					<KnowledgeGraph />
				</>
			) : (
				<>
					{/* Grid — P3: skeleton loading */}
					{isSearchPending ? (
						<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
						<div className="space-y-3">
							{isSearchActive && searchAnswer ? <SearchAnswerPanel answer={searchAnswer} /> : null}
							<div className="rounded-lg border border-border bg-muted p-8 text-center">
								{isSearchActive ? (
									<>
										<p className="text-sm text-muted-foreground">
											{noConfidentResults
												? `No confident evidence-backed results for "${query}".`
												: `No results for "${query}".`}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											Try a more specific topic name, project, organization, or community.
										</p>
									</>
								) : (
									<p className="text-sm text-muted-foreground">
										No knowledge nodes found. Sync messages to extract knowledge from your
										conversations.
									</p>
								)}
							</div>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{isSearchActive && searchAnswer ? (
								<div className="lg:col-span-2">
									<SearchAnswerPanel answer={searchAnswer} />
								</div>
							) : null}
							{(isSearchActive ? nodes : sortByRelevance(nodes)).map((node) => (
								<KnowledgeCard key={node.id} node={node} onNodeUpdated={handleNodeUpdated} />
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

function knowledgeProgressStageLabel(progress: KnowledgeAnalysisProgress): string {
	switch (progress.stage) {
		case 'complete':
			return 'Analysis complete';
		case 'llm':
			return 'Local LLM extraction';
		case 'contacts':
			return 'Contact and embedding pass';
		default:
			return 'Queued';
	}
}

function LocalKnowledgeAnalysisPanel({
	nodes,
	mode,
	selectedMode,
	estimate,
	error,
	onModeChange,
	onRunAnalysis,
	onBuildRelationships,
	isQueued,
	isInferenceRunning,
	lastRequest,
	progress,
	inferenceResult,
	inferenceError,
	messageCoverage,
}: {
	nodes: EnrichedNode[];
	mode: AnalysisMode;
	selectedMode: (typeof ANALYSIS_MODES)[number];
	estimate: KnowledgeAnalysisEstimate | null;
	error: string | null;
	onModeChange: (mode: AnalysisMode) => void;
	onRunAnalysis: () => void;
	onBuildRelationships: () => void;
	isQueued: boolean;
	isInferenceRunning: boolean;
	lastRequest: {
		mode: AnalysisMode;
		requestedAt: Date;
		expectedContacts: number;
		expectedLlmRequests: number;
	} | null;
	progress: KnowledgeAnalysisProgress | null;
	inferenceResult: KnowledgeInferenceRunResult | null;
	inferenceError: string | null;
	messageCoverage?: KnowledgeMessageCoverage;
}) {
	const evidenceRows = nodes.reduce((sum, node) => {
		if (typeof node.evidenceCount === 'number') return sum + node.evidenceCount;
		if (typeof node.aggregateEvidenceCount === 'number') return sum + node.aggregateEvidenceCount;
		return sum + (node.evidence?.length ?? 0);
	}, 0);
	const linkedContacts = nodes.reduce(
		(sum, node) =>
			sum +
			(node.connectedContactsWithEvidence ?? node.connectedContactCount ?? node.contactCount ?? 0),
		0,
	);
	const estimatedUnits =
		nodes.length +
		(mode === 'incremental' ? Math.ceil(evidenceRows * 0.25) : evidenceRows) +
		(mode === 'full' ? linkedContacts : Math.ceil(linkedContacts * 0.5));
	const estimatedWorkUnits = estimate
		? (estimate.embeddingInputsEstimated ?? 0) + (estimate.llmRequestsEstimated ?? 0) * 5
		: estimatedUnits;
	const workLabel =
		estimatedWorkUnits === 0
			? 'Idle'
			: estimatedWorkUnits < 25
				? 'Light'
				: estimatedWorkUnits < 100
					? 'Medium'
					: 'Heavy';
	const canRun = estimate?.canRun !== false && !error;
	const statusLabel = error
		? 'Unavailable'
		: estimate?.enabled === false
			? 'Feature off'
			: estimate?.hasConsent === false
				? 'Consent required'
				: estimate?.canRun === false
					? 'No new work'
					: 'Ready';
	const contactsEstimated = estimate?.contactsEstimated ?? linkedContacts;
	const messagesEstimated = estimate?.messagesEstimated ?? evidenceRows;
	const backfillContactsEstimated = estimate?.backfillContactsEstimated ?? 0;
	const backfillContactsCompletedEstimated = estimate?.backfillContactsCompletedEstimated ?? 0;
	const backfillMessagesScannedEstimated = estimate?.backfillMessagesScannedEstimated ?? 0;
	const embeddingInputsEstimated = estimate?.embeddingInputsEstimated ?? estimatedUnits;
	const embeddingProviderLabel = estimate?.embeddingProviderLabel ?? 'embeddings';
	const llmRequestsEstimated =
		estimate?.llmRequestsEstimated ?? (mode === 'evidence' ? 0 : contactsEstimated);
	const llmCallLabel =
		estimate?.llmProviderMode === 'disabled'
			? 'LLM calls (disabled)'
			: estimate?.llmProviderLabel
				? `${estimate.llmProviderLabel} calls`
				: 'LLM calls';
	const progressPercent = Math.max(0, Math.min(100, progress?.percent ?? 0));
	const progressContactTotal = progress?.expectedContacts ?? contactsEstimated;
	const progressLlmTotal = progress?.expectedLlmRequests ?? llmRequestsEstimated;
	const hasAiConsent = estimate?.hasConsent !== false;
	const coverageStats = messageCoverage
		? [
				{
					label: 'Imported',
					value: formatCompactCount(messageCoverage.totalMessages),
					detail: 'messages',
				},
				{
					label: 'Contact-linked',
					value: formatCoveragePercent(
						messageCoverage.linkedContactMessages,
						messageCoverage.totalMessages,
					),
					detail: `${formatCompactCount(messageCoverage.linkedContactMessages)} rows`,
				},
				{
					label: 'Sender-attributed',
					value: formatCoveragePercent(
						messageCoverage.messagesWithUserSenderMetadata,
						messageCoverage.totalMessages,
					),
					detail: `${formatCompactCount(
						messageCoverage.messagesWithUserSenderMetadata,
					)} user senders`,
				},
				{
					label: 'Needs attribution',
					value: formatCompactCount(messageCoverage.nullContactMessages),
					detail: `${messageCoverage.chatsWithNullContactMessages} chats`,
				},
			]
		: [];

	return (
		<section className="mb-4 rounded-lg border border-border bg-card p-4">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-sm font-semibold text-foreground">Local analysis</h2>
						<span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
							{workLabel} work
						</span>
						<span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
							{statusLabel}
						</span>
					</div>
					<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						<span>{contactsEstimated} contacts</span>
						<span>{messagesEstimated} messages</span>
						{mode === 'full' && backfillContactsEstimated > 0 ? (
							<span>
								{backfillContactsCompletedEstimated} historical contacts complete,{' '}
								{backfillContactsEstimated} need backfill
							</span>
						) : mode === 'full' && backfillContactsCompletedEstimated > 0 ? (
							<span>{backfillContactsCompletedEstimated} historical contacts complete</span>
						) : null}
						{mode === 'full' && backfillMessagesScannedEstimated > 0 ? (
							<span>{backfillMessagesScannedEstimated} messages already scanned</span>
						) : null}
						<span>{embeddingInputsEstimated} embedding inputs</span>
						<span>{embeddingProviderLabel}</span>
						<span>
							{llmRequestsEstimated} {llmCallLabel}
						</span>
					</div>
				</div>

				<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
					<div className="grid w-full grid-cols-3 gap-1 rounded-md border border-border bg-muted/40 p-1 sm:w-auto sm:min-w-[20rem]">
						{ANALYSIS_MODES.map((item) => (
							<button
								key={item.key}
								type="button"
								onClick={() => onModeChange(item.key)}
								aria-pressed={mode === item.key}
								className={`min-w-0 rounded px-2 py-1.5 text-center text-xs transition-colors ${
									mode === item.key
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
								}`}
								title={item.description}
							>
								<span className="block font-medium">{item.label}</span>
								<span className="hidden text-muted-foreground xl:block">{item.description}</span>
							</button>
						))}
					</div>

					<button
						type="button"
						aria-label="Run analysis"
						onClick={onRunAnalysis}
						disabled={isQueued || !canRun}
						className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>
						{isQueued ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
						{isQueued ? 'Queued' : 'Run analysis'}
					</button>
					<button
						type="button"
						onClick={onBuildRelationships}
						disabled={isInferenceRunning || !hasAiConsent || nodes.length < 2}
						className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
					>
						{isInferenceRunning ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Network className="h-4 w-4" />
						)}
						{isInferenceRunning ? 'Building' : 'Build relationships'}
					</button>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
				<span>Mode: {selectedMode.label}</span>
				{lastRequest ? (
					<span>
						Last queued {ANALYSIS_MODES.find((item) => item.key === lastRequest.mode)?.label} at{' '}
						{lastRequest.requestedAt.toLocaleTimeString()}
					</span>
				) : (
					<span>No analysis queued in this view</span>
				)}
				{error ? <span>{error}</span> : null}
				{inferenceResult ? (
					<span>
						Relationships: {inferenceResult.totalLinks ?? 0} links from{' '}
						{inferenceResult.nodesProcessed ?? 0} nodes
					</span>
				) : null}
				{inferenceError ? <span>{inferenceError}</span> : null}
				{!hasAiConsent ? (
					<Link href="/settings" className="font-medium text-primary hover:underline">
						Enable AI analysis in Settings
					</Link>
				) : null}
			</div>

			{coverageStats.length > 0 ? (
				<div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-4">
					{coverageStats.map((stat) => (
						<div key={stat.label} className="min-w-0">
							<div className="text-[11px] font-medium uppercase text-muted-foreground">
								{stat.label}
							</div>
							<div className="mt-0.5 text-sm font-semibold text-foreground">{stat.value}</div>
							<div className="truncate text-xs text-muted-foreground" title={stat.detail}>
								{stat.detail}
							</div>
						</div>
					))}
				</div>
			) : null}

			{progress ? (
				<div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
						<span className="font-medium text-foreground">
							{knowledgeProgressStageLabel(progress)}
						</span>
						<span className="text-muted-foreground">{progressPercent}%</span>
					</div>
					<div
						className="h-2 overflow-hidden rounded-full bg-muted"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={progressPercent}
						tabIndex={0}
					>
						<div
							className="h-full rounded-full bg-primary transition-all"
							style={{ width: `${progressPercent}%` }}
						/>
					</div>
					<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						<span>
							Contacts {progress.processedContacts ?? 0}/{progressContactTotal}
						</span>
						{progressLlmTotal > 0 ? (
							<span>
								Local LLM {progress.llmCompleted ?? 0}/{progressLlmTotal} estimated
							</span>
						) : null}
						<span>{progress.entitiesExtracted ?? 0} entities linked</span>
						{mode === 'full' ? (
							<>
								<span>
									Backfill {progress.backfillContactsCompleted ?? 0} complete
									{progress.backfillContactsInProgress
										? `, ${progress.backfillContactsInProgress} in progress`
										: ''}
								</span>
								<span>{progress.backfillMessagesScanned ?? 0} messages scanned</span>
							</>
						) : null}
						<span>{progress.nodeCount ?? 0} nodes</span>
						<span>{progress.evidenceCount ?? 0} evidence rows</span>
						{progress.latestUpdateAt ? (
							<span>Updated {formatRelativeDate(progress.latestUpdateAt)}</span>
						) : null}
						{progress.error ? <span>{progress.error}</span> : null}
					</div>
				</div>
			) : null}
		</section>
	);
}

function ManualKnowledgeNodePanel({
	type,
	name,
	description,
	result,
	error,
	stage,
	isPending,
	onTypeChange,
	onNameChange,
	onDescriptionChange,
	onCreate,
}: {
	type: NodeType;
	name: string;
	description: string;
	result: ManualKnowledgeNodeResult | null;
	error: string | null;
	stage: 'idle' | 'creating' | 'complete' | 'error';
	isPending: boolean;
	onTypeChange: (type: NodeType) => void;
	onNameChange: (name: string) => void;
	onDescriptionChange: (description: string) => void;
	onCreate: () => void;
}) {
	const buildSummary = result ? manualKnowledgeBuildSummary(result) : null;

	return (
		<section className="mb-4 rounded-lg border border-border bg-card p-4">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-end">
				<div className="grid flex-1 gap-3 sm:grid-cols-[160px_1fr_1.3fr]">
					<label className="grid gap-1 text-xs font-medium text-muted-foreground">
						Type
						<select
							value={type}
							onChange={(event) => onTypeChange(event.target.value as NodeType)}
							className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
						>
							{TYPE_TABS.filter(
								(item): item is { key: NodeType; label: string } => item.key !== 'all',
							).map((item) => (
								<option key={item.key} value={item.key}>
									{item.label}
								</option>
							))}
						</select>
					</label>
					<label className="grid gap-1 text-xs font-medium text-muted-foreground">
						Name
						<input
							value={name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder="Topic or project"
							className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
						/>
					</label>
					<label className="grid gap-1 text-xs font-medium text-muted-foreground">
						Context
						<input
							value={description}
							onChange={(event) => onDescriptionChange(event.target.value)}
							placeholder="Optional local context"
							className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
						/>
					</label>
				</div>
				<button
					type="button"
					onClick={onCreate}
					disabled={isPending || name.trim().length < 2}
					className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
				>
					{isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
					{isPending ? 'Building' : 'Add knowledge'}
				</button>
			</div>
			{result || error ? (
				<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
					{result?.created ? (
						<span>Added {result.node?.displayName ?? 'knowledge node'}</span>
					) : null}
					{buildSummary ? <span>{buildSummary}</span> : null}
					{result?.buildError ? <span>{result.buildError}</span> : null}
					{error ? <span>{error}</span> : null}
				</div>
			) : null}
			<ManualBuildProgress result={result} stage={stage} isPending={isPending} />
		</section>
	);
}

function ManualBuildProgress({
	result,
	stage,
	isPending,
}: {
	result: ManualKnowledgeNodeResult | null;
	stage: 'idle' | 'creating' | 'complete' | 'error';
	isPending: boolean;
}) {
	if (stage === 'idle' && !result) return null;
	const analysisDone = Boolean(result?.analysis);
	const inferenceDone = Boolean(result?.inference);
	const buildQueued = Boolean(result?.buildQueued);
	const steps = [
		{
			label: 'Node',
			done: stage === 'complete' || Boolean(result?.created),
			detail: result?.node?.displayName ?? (isPending ? 'Creating' : 'Ready'),
		},
		{
			label: 'Evidence',
			done: analysisDone,
			detail: analysisDone
				? manualEvidenceDetail(result)
				: buildQueued
					? 'Queued in local worker'
					: isPending
						? 'Running local pass'
						: 'Not run yet',
		},
		{
			label: 'Relationships',
			done: inferenceDone,
			detail: inferenceDone
				? `${result?.inference?.totalLinks ?? 0} links`
				: buildQueued
					? 'Queued after evidence'
					: isPending
						? 'Queued after evidence'
						: 'Not run yet',
		},
	];

	return (
		<div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
			{steps.map((step) => (
				<div key={step.label} className="rounded-md border border-border bg-background p-2">
					<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
						{step.done ? (
							<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
						) : isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						) : (
							<span className="h-3.5 w-3.5 rounded-full border border-border" />
						)}
						{step.label}
					</div>
					<p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
				</div>
			))}
		</div>
	);
}

function SearchAnswerPanel({ answer }: { answer: KnowledgeSearchAnswer }) {
	return (
		<section className="rounded-lg border border-border bg-card p-4">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-md bg-indigo-100 p-1.5 text-indigo-700">
					<CircleHelp className="h-4 w-4" />
				</div>
				<div className="min-w-0 flex-1">
					<h2 className="text-sm font-semibold text-foreground">{answer.title}</h2>
					<p className="mt-1 text-sm text-muted-foreground">{answer.summary}</p>
					{answer.support.length > 0 ? (
						<div className="mt-3 flex flex-wrap gap-2">
							{answer.support.map((item) => (
								<span
									key={item}
									className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
								>
									{item}
								</span>
							))}
						</div>
					) : null}
					<p className="mt-2 text-xs text-muted-foreground">{answer.suggestedAction}</p>
				</div>
			</div>
		</section>
	);
}

function manualKnowledgeBuildSummary(result: ManualKnowledgeNodeResult): string | null {
	if (result.buildStatus === 'complete') {
		const parts = ['build complete'];
		const contacts = result.manualEvidence?.contactsScanned ?? result.analysis?.contactsProcessed;
		const newEvidence = result.manualEvidence?.evidenceCreated ?? result.analysis?.embeddingMatches;
		const totalEvidence = result.manualEvidence?.totalEvidenceRows;
		const links = result.inference?.totalLinks;
		if (typeof contacts === 'number') parts.push(`scanned ${formatCount(contacts, 'contact')}`);
		if (typeof newEvidence === 'number') {
			parts.push(`${formatCount(newEvidence, 'new evidence row')}`);
		}
		if (typeof totalEvidence === 'number') {
			parts.push(`${formatCount(totalEvidence, 'total evidence row')}`);
		}
		if (typeof links === 'number') parts.push(`${formatCount(links, 'link')}`);
		return parts.join('; ');
	}
	if (result.buildQueued) return 'local evidence build queued';
	if (result.buildStatus === 'skipped') {
		return result.manualEvidence?.skippedReason
			? `build skipped: ${result.manualEvidence.skippedReason}`
			: 'build skipped';
	}
	if (result.buildStatus) return `build ${result.buildStatus}`;
	return null;
}

function manualEvidenceDetail(result: ManualKnowledgeNodeResult | null): string {
	const manualEvidence = result?.manualEvidence;
	if (manualEvidence) {
		const newRows = manualEvidence.evidenceCreated ?? 0;
		const totalRows = manualEvidence.totalEvidenceRows ?? 0;
		const totalContacts = manualEvidence.totalEvidenceContacts ?? 0;
		const totalMessages = manualEvidence.totalEvidenceMessages ?? 0;
		return `${formatCount(newRows, 'new row')}, ${formatCount(totalRows, 'total row')}; ${formatCount(totalContacts, 'contact')}, ${formatCount(totalMessages, 'message')}`;
	}
	return `${result?.analysis?.contactsProcessed ?? 0} contacts, ${result?.analysis?.embeddingMatches ?? 0} matches`;
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
	return `${value} ${value === 1 ? singular : plural}`;
}

function coerceDate(value?: Date | string | null): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function coerceReviewStatus(value?: string | null): ReviewStatus | null {
	return value === 'reviewed' || value === 'needs_review' ? value : null;
}

function normalizeEnrichedNode(node: EnrichedNode): EnrichedNode {
	return {
		...node,
		reviewStatus: coerceReviewStatus(node.reviewStatus),
	};
}

function formatPercent(value?: number | null): string {
	if (typeof value !== 'number' || Number.isNaN(value)) return 'unknown confidence';
	return `${Math.round(value * 100)}%`;
}

function contactName(contact: SearchContactPreview): string {
	return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown contact';
}

function KnowledgeCard({
	node: initialNode,
	onNodeUpdated,
}: {
	node: EnrichedNode;
	onNodeUpdated: (node: EnrichedNode) => void;
}) {
	const [localNode, setLocalNode] = useState(initialNode);
	const [showReview, setShowReview] = useState(false);
	const [showRelationships, setShowRelationships] = useState(false);
	const [reviewType, setReviewType] = useState<NodeType>((initialNode.type as NodeType) ?? 'topic');
	const [reviewName, setReviewName] = useState(initialNode.displayName);
	const [reviewDescription, setReviewDescription] = useState(initialNode.description ?? '');
	const [reviewMessage, setReviewMessage] = useState<string | null>(null);
	const [reviewError, setReviewError] = useState<string | null>(null);
	const [relationshipExplanations, setRelationshipExplanations] = useState<
		RelationshipExplanation[] | null
	>(null);
	const [relationshipError, setRelationshipError] = useState<string | null>(null);
	const [isReviewPending, startReviewTransition] = useTransition();
	const [isRelationshipPending, startRelationshipTransition] = useTransition();

	React.useEffect(() => {
		setLocalNode(initialNode);
		setReviewType((initialNode.type as NodeType) ?? 'topic');
		setReviewName(initialNode.displayName);
		setReviewDescription(initialNode.description ?? '');
	}, [initialNode]);

	function applyUpdatedNode(updatedNode: EnrichedNode) {
		setLocalNode((current) => ({ ...current, ...updatedNode }));
		onNodeUpdated(updatedNode);
	}

	function handleSaveReview(status: ReviewStatus) {
		startReviewTransition(async () => {
			setReviewMessage(null);
			setReviewError(null);
			const result = await reviewKnowledgeNodeAction({
				nodeId: localNode.id,
				type: reviewType,
				displayName: reviewName.trim(),
				description: reviewDescription.trim() || null,
				status,
			});
			if (result?.data?.updated && result.data.node) {
				applyUpdatedNode(result.data.node as EnrichedNode);
				setReviewMessage(status === 'reviewed' ? 'Review saved' : 'Marked for review');
				setShowReview(false);
			} else {
				setReviewError(
					(result?.data as { error?: string } | undefined)?.error ?? 'Unable to save review',
				);
			}
		});
	}

	function handleLoadRelationships() {
		if (showRelationships && relationshipExplanations) {
			setShowRelationships(false);
			return;
		}
		setShowRelationships(true);
		startRelationshipTransition(async () => {
			setRelationshipError(null);
			const result = await getKnowledgeRelationshipExplanationsAction({
				nodeId: localNode.id,
				limit: 4,
			});
			if (result?.data) {
				setRelationshipExplanations(result.data.explanations as RelationshipExplanation[]);
			} else {
				setRelationshipError('Unable to explain relationships');
			}
		});
	}

	const node = localNode;
	const contactCount = node.contactCount ?? 0;
	const previews = node.contactPreviews ?? [];
	const evidence = node.evidence ?? [];
	const contacts = node.contacts ?? [];
	const qualitySignals = qualitySignalsForNode(node);
	const latestEvidenceAt = coerceDate(node.latestEvidenceAt);
	const messageMatchedAt = coerceDate(node.messageMatchedAt);
	const messageHitCount = node.messageHitCount ?? 0;
	const directSourceMessageCount = node.directEvidenceMessages ?? 0;
	const directEvidenceRows = node.directEvidenceRows ?? 0;
	const directEvidenceContacts = node.directEvidenceContacts ?? 0;
	const rawSourceMessageCount = node.distinctEvidenceMessages ?? 0;
	const rawEvidenceRows = node.evidenceCount ?? 0;
	const possibleEvidenceRows = node.possibleEvidenceRows ?? 0;
	const weakEvidenceRows = node.weakEvidenceRows ?? 0;
	const messageMatchedEvidenceIds = new Set(node.messageMatchedEvidenceIds ?? []);
	const hasSearchEvidenceFields =
		typeof node.matchScore === 'number' ||
		evidence.length > 0 ||
		contacts.length > 0 ||
		typeof node.aggregateEvidenceCount === 'number';

	return (
		<article
			className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-border hover:bg-accent"
			style={{ opacity: typeof node.opacity === 'number' ? node.opacity : undefined }}
		>
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<span
					className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[node.type as NodeType] || 'bg-gray-100 text-gray-700'}`}
				>
					{node.type}
				</span>
				{node.reviewStatus ? (
					<span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
						{node.reviewStatus === 'needs_review' ? 'Needs review' : 'Reviewed'}
					</span>
				) : null}
				{typeof node.matchScore === 'number' ? (
					<span className="text-xs text-muted-foreground">
						{formatPercent(node.matchScore)} match
					</span>
				) : null}
				{typeof node.topConfidence === 'number' ? (
					<span className="text-xs text-muted-foreground">
						{formatPercent(node.topConfidence)} confidence
					</span>
				) : null}
				{messageHitCount > 0 ? (
					<span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
						Matched in message evidence
					</span>
				) : null}
			</div>
			<Link
				href={`/knowledge/${node.id}`}
				className="font-medium text-foreground hover:text-indigo-700"
			>
				{node.displayName}
			</Link>
			{node.description ? (
				<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{node.description}</p>
			) : null}
			{qualitySignals.length > 0 ? (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{qualitySignals.map((signal) => (
						<span
							key={signal}
							className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
						>
							{signal}
						</span>
					))}
				</div>
			) : null}
			<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				{directSourceMessageCount > 0 ? (
					<span>
						{directSourceMessageCount} direct source message
						{directSourceMessageCount === 1 ? '' : 's'}
					</span>
				) : null}
				{directEvidenceRows > 0 ? (
					<span>
						{directEvidenceRows} direct evidence row{directEvidenceRows === 1 ? '' : 's'}
					</span>
				) : null}
				{directEvidenceContacts > 0 ? (
					<span>
						{directEvidenceContacts} direct evidence contact
						{directEvidenceContacts === 1 ? '' : 's'}
					</span>
				) : null}
				{possibleEvidenceRows > 0 ? (
					<span>
						{possibleEvidenceRows} possible row{possibleEvidenceRows === 1 ? '' : 's'}
					</span>
				) : null}
				{weakEvidenceRows > 0 ? (
					<span>
						{weakEvidenceRows} weak row{weakEvidenceRows === 1 ? '' : 's'}
					</span>
				) : null}
				{rawEvidenceRows > 0 && directEvidenceRows !== rawEvidenceRows ? (
					<span>
						{rawEvidenceRows} total evidence row{rawEvidenceRows === 1 ? '' : 's'}
					</span>
				) : null}
				<span>{node.mentionCount ?? 0} extraction signals</span>
				{latestEvidenceAt ? <span>Latest {formatRelativeDate(latestEvidenceAt)}</span> : null}
				{messageHitCount > 0 ? (
					<span>
						{messageHitCount} message match{messageHitCount === 1 ? '' : 'es'}
					</span>
				) : null}
				{messageMatchedAt ? <span>Matched {formatRelativeDate(messageMatchedAt)}</span> : null}
				{contactCount > 0 ? (
					<span>
						{previews.join(', ')}
						{contactCount > 3 ? ` + ${contactCount - 3} more` : ''}
					</span>
				) : null}
				{rawSourceMessageCount > 0 && directSourceMessageCount === 0 ? (
					<span>{rawSourceMessageCount} source messages need review</span>
				) : null}
			</div>

			{contacts.length > 0 ? (
				<div className="mt-3 flex flex-wrap gap-1.5">
					{contacts.slice(0, 3).map((contact) => (
						<span
							key={`${node.id}-${contact.id}-${contact.relationType}`}
							className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
						>
							{contactName(contact)} - {contact.relationType.replace(/_/g, ' ')}
						</span>
					))}
				</div>
			) : null}

			{evidence.length > 0 ? (
				<ul className="mt-3 space-y-2">
					{evidence.slice(0, 2).map((item) => {
						const occurredAt = coerceDate(item.occurredAt);
						const isMessageMatch = messageMatchedEvidenceIds.has(item.id);
						return (
							<li key={item.id} className="rounded-md border border-border bg-background p-3">
								<div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
									{isMessageMatch ? (
										<span className="font-medium text-emerald-700">message match</span>
									) : null}
									<span>{item.claimLabel}</span>
									<span>{item.evidenceKind.replace(/_/g, ' ')}</span>
									{typeof item.confidence === 'number' ? (
										<span>{formatPercent(item.confidence)} confidence</span>
									) : null}
									{occurredAt ? <span>{formatRelativeDate(occurredAt)}</span> : null}
								</div>
								<p className="line-clamp-2 text-sm text-foreground">
									{item.snippet ?? 'Evidence captured without a snippet.'}
								</p>
							</li>
						);
					})}
				</ul>
			) : hasSearchEvidenceFields && rawEvidenceRows === 0 && rawSourceMessageCount === 0 ? (
				<p className="mt-3 rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
					This topic exists, but no source message evidence has been stored yet.
				</p>
			) : null}

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Link href={`/knowledge/${node.id}`} className="text-xs font-medium text-indigo-700">
					Open topic
				</Link>
				<button
					type="button"
					onClick={() => setShowReview((value) => !value)}
					className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<Pencil className="h-3.5 w-3.5" />
					Review
				</button>
				<button
					type="button"
					onClick={handleLoadRelationships}
					className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<CircleHelp className="h-3.5 w-3.5" />
					Why connected?
				</button>
				{reviewMessage ? <span className="text-xs text-emerald-700">{reviewMessage}</span> : null}
			</div>

			{showReview ? (
				<div className="mt-3 rounded-md border border-border bg-background p-3">
					<div className="grid gap-3 sm:grid-cols-[140px_1fr]">
						<label className="grid gap-1 text-xs font-medium text-muted-foreground">
							Type
							<select
								value={reviewType}
								onChange={(event) => setReviewType(event.target.value as NodeType)}
								className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							>
								{TYPE_TABS.filter(
									(item): item is { key: NodeType; label: string } => item.key !== 'all',
								).map((item) => (
									<option key={item.key} value={item.key}>
										{item.label}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1 text-xs font-medium text-muted-foreground">
							Name
							<input
								value={reviewName}
								onChange={(event) => setReviewName(event.target.value)}
								className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							/>
						</label>
						<label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
							Context
							<input
								value={reviewDescription}
								onChange={(event) => setReviewDescription(event.target.value)}
								className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							/>
						</label>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => handleSaveReview('reviewed')}
							disabled={isReviewPending || reviewName.trim().length < 2}
							className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
						>
							{isReviewPending ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<CheckCircle2 className="h-3.5 w-3.5" />
							)}
							Save review
						</button>
						<button
							type="button"
							onClick={() => handleSaveReview('needs_review')}
							disabled={isReviewPending}
							className="h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground disabled:pointer-events-none disabled:opacity-50"
						>
							Needs review
						</button>
						{reviewError ? <span className="text-xs text-destructive">{reviewError}</span> : null}
					</div>
				</div>
			) : null}

			{showRelationships ? (
				<div className="mt-3 rounded-md border border-border bg-background p-3">
					<p className="text-xs font-semibold text-foreground">Relationship explanations</p>
					{isRelationshipPending ? (
						<p className="mt-2 text-xs text-muted-foreground">Loading relationships...</p>
					) : relationshipExplanations && relationshipExplanations.length > 0 ? (
						<ul className="mt-2 space-y-2">
							{relationshipExplanations.map((item) => (
								<li key={item.id} className="rounded border border-border bg-muted/30 p-2">
									<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span className="font-medium text-foreground">{item.neighbor.displayName}</span>
										<span>{item.linkType.replace(/_/g, ' ')}</span>
										{typeof item.weight === 'number' ? (
											<span>{formatPercent(item.weight)} weight</span>
										) : null}
									</div>
									<p className="mt-1 text-xs text-muted-foreground">{item.explanation}</p>
									{item.evidence[0]?.snippet ? (
										<p className="mt-1 line-clamp-2 text-xs text-foreground">
											{item.evidence[0].snippet}
										</p>
									) : null}
								</li>
							))}
						</ul>
					) : (
						<p className="mt-2 text-xs text-muted-foreground">
							No direct relationship explanations are available yet.
						</p>
					)}
					{relationshipError ? (
						<p className="mt-2 text-xs text-destructive">{relationshipError}</p>
					) : null}
				</div>
			) : null}
		</article>
	);
}

function qualitySignalsForNode(node: EnrichedNode): string[] {
	const signals = new Set<string>();
	if (!node.reviewStatus) signals.add('Unreviewed');
	if (node.reviewStatus === 'needs_review') signals.add('Needs review');
	const directEvidenceCount = node.directEvidenceRows ?? 0;
	const possibleEvidenceCount = node.possibleEvidenceRows ?? 0;
	const weakEvidenceCount = node.weakEvidenceRows ?? 0;
	const evidenceCount =
		node.evidenceCount ?? node.aggregateEvidenceCount ?? node.evidence?.length ?? 0;
	if (directEvidenceCount === 0) signals.add('Needs direct evidence');
	if (possibleEvidenceCount > 0 || weakEvidenceCount > 0) signals.add('Review evidence quality');
	if (evidenceCount === 0) signals.add('Needs source evidence');
	if (typeof node.topConfidence === 'number' && node.topConfidence < 0.7) {
		signals.add('Low confidence');
	}
	if (node.evidence?.some((item) => item.evidenceKind === 'manual')) signals.add('Manual');
	return [...signals].slice(0, 3);
}

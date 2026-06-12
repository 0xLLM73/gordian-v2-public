'use client';

import * as React from 'react';
import { generateDigestAction, listDigestsAction } from '@/app/actions/digest';

type Period = 'today' | 'yesterday' | '3d' | 'week';

interface DigestSections {
	activity_overview?: {
		summary: string;
		message_count: number;
		active_conversations: number;
		new_contacts?: number;
	};
	source_coverage?: {
		total_messages: number;
		sampled_messages: number;
		total_conversations: number;
		sampled_conversations: number;
		prompt_conversations: number;
		prompt_messages?: number;
		sample_strategy: string;
		message_budget: number;
		batch_count?: number;
		batch_messages?: number;
		batch_strategy?: string;
	};
	highlights?: Array<{
		title: string;
		detail: string;
		contact_ref?: string;
	}>;
	key_conversations?: Array<{
		contact_ref: string;
		summary: string;
		sentiment?: 'positive' | 'neutral' | 'negative';
	}>;
	action_items?: Array<{
		item: string;
		priority: 'high' | 'medium' | 'low';
		contact_ref?: string;
	}>;
	watch_list?: Array<{
		contact_ref: string;
		reason: string;
	}>;
}

interface DigestRecord {
	id: string;
	period: string;
	periodStart: Date | string;
	periodEnd: Date | string;
	content: string | null;
	sections: unknown;
	messageCount: number | null;
	contactCount: number | null;
	generatedAt: Date | string | null;
	createdAt: Date | string;
	styleVariant: string | null;
	toneVariant: string | null;
}

interface DigestViewerProps {
	pastDigests: DigestRecord[];
	contactMap?: Record<string, string>;
	canGenerate?: boolean;
	generateDisabledReason?: string;
}

const PERIOD_LABELS: Record<Period, string> = {
	today: 'Today',
	yesterday: 'Yesterday',
	'3d': 'Last 3 Days',
	week: 'Last Week',
};

const DIGEST_POLL_INTERVAL_MS = 5000;
const DIGEST_POLL_MAX_ATTEMPTS = 36;

export function DigestViewer({
	pastDigests: initialDigests,
	contactMap = {},
	canGenerate = true,
	generateDisabledReason,
}: DigestViewerProps) {
	const [period, setPeriod] = React.useState<Period>('today');
	const [digests, setDigests] = React.useState<DigestRecord[]>(initialDigests);
	const [selectedDigest, setSelectedDigest] = React.useState<DigestRecord | null>(
		initialDigests[0] ?? null,
	);
	const [isPending, startTransition] = React.useTransition();
	const [generating, setGenerating] = React.useState(false);
	const [generateError, setGenerateError] = React.useState<string | null>(null);
	const pollTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(() => {
		return () => {
			if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
		};
	}, []);

	function clearDigestPoll() {
		if (!pollTimeoutRef.current) return;
		clearTimeout(pollTimeoutRef.current);
		pollTimeoutRef.current = null;
	}

	function pollForDigest(previousLatestId: string | null, attempt = 0) {
		pollTimeoutRef.current = setTimeout(() => {
			pollTimeoutRef.current = null;
			startTransition(async () => {
				const updated = await listDigestsAction({ limit: 10 });
				if (updated?.data) {
					setDigests(updated.data);
					const latest = updated.data[0] ?? null;
					if (latest && latest.id !== previousLatestId) {
						setSelectedDigest(latest);
						setGenerating(false);
						return;
					}
				}

				if (attempt + 1 >= DIGEST_POLL_MAX_ATTEMPTS) {
					setGenerateError(
						'Digest generation is still running. Refresh this page or try again in a minute.',
					);
					setGenerating(false);
					return;
				}

				pollForDigest(previousLatestId, attempt + 1);
			});
		}, DIGEST_POLL_INTERVAL_MS);
	}

	function handleGenerate() {
		if (!canGenerate) {
			setGenerateError(generateDisabledReason ?? 'Digest generation is currently unavailable.');
			return;
		}

		setGenerateError(null);
		setGenerating(true);
		clearDigestPoll();
		const previousLatestId = digests[0]?.id ?? null;
		startTransition(async () => {
			const result = await generateDigestAction({ period });
			if (result?.data?.queued) {
				pollForDigest(previousLatestId);
			} else {
				setGenerateError(result?.serverError ?? 'Digest generation could not be started.');
				setGenerating(false);
			}
		});
	}

	function handleSelectDigest(d: DigestRecord) {
		setSelectedDigest(d);
	}

	const sections = selectedDigest?.sections ? (selectedDigest.sections as DigestSections) : null;

	// Replace contactId UUIDs with display names throughout text
	const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
	function resolveText(text: string | undefined | null): string {
		if (!text) return '';
		if (Object.keys(contactMap).length === 0) return text;
		return text.replace(UUID_RE, (match) => contactMap[match.toLowerCase()] ?? match);
	}

	return (
		<div className="space-y-6">
			{/* Period selector + generate button */}
			<div className="flex items-center gap-3">
				<div className="flex rounded-lg border border-border bg-card">
					{(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([key, label]) => (
						<button
							key={key}
							type="button"
							onClick={() => setPeriod(key)}
							className={`px-4 py-2 text-sm font-medium transition-colors ${
								period === key ? 'bg-gray-900 text-white' : 'text-muted-foreground hover:bg-accent'
							} ${key === 'today' ? 'rounded-l-lg' : ''} ${key === 'week' ? 'rounded-r-lg' : ''}`}
						>
							{label}
						</button>
					))}
				</div>
				<button
					type="button"
					onClick={handleGenerate}
					disabled={!canGenerate || isPending || generating}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					{generating ? 'Generating...' : 'Generate Digest'}
				</button>
			</div>
			{!canGenerate || generateError ? (
				<p className="text-sm text-muted-foreground">{generateError ?? generateDisabledReason}</p>
			) : null}

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Digest content */}
				<div className="lg:col-span-2">
					{selectedDigest ? (
						<DigestContent
							sections={sections}
							content={selectedDigest.content}
							resolveText={resolveText}
						/>
					) : (
						<EmptyState />
					)}
				</div>

				{/* Past digests sidebar */}
				<div>
					<h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">
						Past Digests
					</h3>
					{digests.length === 0 ? (
						<p className="text-sm text-muted-foreground">No digests generated yet.</p>
					) : (
						<div className="space-y-2">
							{digests.map((d) => (
								<button
									key={d.id}
									type="button"
									onClick={() => handleSelectDigest(d)}
									className={`w-full rounded-lg border p-3 text-left transition-colors ${
										selectedDigest?.id === d.id
											? 'border-blue-300 bg-blue-50'
											: 'border-border bg-card hover:border-border'
									}`}
								>
									<p className="text-sm font-medium text-foreground">
										{PERIOD_LABELS[d.period as Period] ?? d.period}
									</p>
									<p className="text-xs text-muted-foreground">{formatDate(d.generatedAt)}</p>
									{d.messageCount !== null ? (
										<p className="mt-1 text-xs text-muted-foreground">
											{d.messageCount} messages, {d.contactCount} conversations
										</p>
									) : null}
								</button>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function DigestContent({
	sections,
	content,
	resolveText,
}: {
	sections: DigestSections | null;
	content: string | null;
	resolveText: (text: string | undefined | null) => string;
}) {
	if (!sections && !content) return <EmptyState />;

	// If structured sections exist, render them richly
	if (sections) {
		return (
			<div className="space-y-6">
				{/* Activity Overview */}
				{sections.activity_overview ? (
					<Section title="Activity Overview">
						<p className="text-sm text-foreground">
							{resolveText(sections.activity_overview.summary)}
						</p>
						<div className="mt-3 grid grid-cols-3 gap-3">
							<Stat label="Messages" value={sections.activity_overview.message_count} />
							<Stat label="Conversations" value={sections.activity_overview.active_conversations} />
							<Stat label="New Contacts" value={sections.activity_overview.new_contacts ?? 0} />
						</div>
						<SourceCoverage coverage={sections.source_coverage} />
					</Section>
				) : null}

				{/* Highlights */}
				{sections.highlights && sections.highlights.length > 0 ? (
					<Section title="Highlights">
						<ul className="space-y-2">
							{sections.highlights.map((h) => (
								<li key={h.title} className="text-sm">
									<span className="font-medium text-foreground">{resolveText(h.title)}</span>
									<span className="text-muted-foreground"> — {resolveText(h.detail)}</span>
								</li>
							))}
						</ul>
					</Section>
				) : null}

				{/* Key Conversations */}
				{sections.key_conversations && sections.key_conversations.length > 0 ? (
					<Section title="Key Conversations">
						<ul className="space-y-3">
							{sections.key_conversations.map((c) => (
								<li key={c.contact_ref} className="text-sm">
									<div className="flex items-center gap-2">
										<span className="font-medium text-foreground">
											{resolveText(c.contact_ref)}
										</span>
										{c.sentiment ? <SentimentBadge sentiment={c.sentiment} /> : null}
									</div>
									<p className="mt-0.5 text-muted-foreground">{resolveText(c.summary)}</p>
								</li>
							))}
						</ul>
					</Section>
				) : null}

				{/* Action Items */}
				{sections.action_items && sections.action_items.length > 0 ? (
					<Section title="Action Items">
						<ul className="space-y-2">
							{sections.action_items.map((a) => (
								<li key={a.item} className="flex items-start gap-2 text-sm">
									<PriorityBadge priority={a.priority} />
									<span className="text-foreground">{resolveText(a.item)}</span>
								</li>
							))}
						</ul>
					</Section>
				) : null}

				{/* Watch List */}
				{sections.watch_list && sections.watch_list.length > 0 ? (
					<Section title="Watch List">
						<ul className="space-y-2">
							{sections.watch_list.map((w) => (
								<li key={w.contact_ref} className="text-sm">
									<span className="font-medium text-amber-700">{resolveText(w.contact_ref)}</span>
									<span className="text-muted-foreground"> — {resolveText(w.reason)}</span>
								</li>
							))}
						</ul>
					</Section>
				) : null}
			</div>
		);
	}

	// Fallback: render plain text content
	return (
		<Section title="Digest">
			<pre className="whitespace-pre-wrap text-sm text-foreground">{resolveText(content)}</pre>
		</Section>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-lg border border-border bg-card p-5">
			<h3 className="mb-3 text-sm font-semibold text-foreground uppercase tracking-wide">
				{title}
			</h3>
			{children}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-md bg-muted p-3 text-center">
			<p className="text-2xl font-bold text-foreground">{value}</p>
			<p className="text-xs text-muted-foreground">{label}</p>
		</div>
	);
}

function SourceCoverage({ coverage }: { coverage: DigestSections['source_coverage'] }) {
	if (!coverage) return null;

	const usedFullPeriod = coverage.sampled_messages >= coverage.total_messages;
	const conversationLabel = coverage.total_conversations === 1 ? 'conversation' : 'conversations';
	const promptConversationLabel =
		coverage.prompt_conversations === 1 ? 'conversation' : 'conversations';
	const messageCoveragePercent = percent(coverage.sampled_messages, coverage.total_messages);
	const promptCoveragePercent = percent(
		coverage.prompt_messages ?? coverage.sampled_messages,
		coverage.total_messages,
	);
	const conversationCoveragePercent = percent(
		coverage.prompt_conversations,
		coverage.total_conversations,
	);

	return (
		<div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
			<div className="mb-3 grid gap-3 sm:grid-cols-3">
				<CoverageMeter
					label="Messages sampled"
					value={messageCoveragePercent}
					detail={`${formatNumber(coverage.sampled_messages)} / ${formatNumber(coverage.total_messages)}`}
				/>
				<CoverageMeter
					label="Prompt excerpts"
					value={promptCoveragePercent}
					detail={`${formatNumber(coverage.prompt_messages ?? coverage.sampled_messages)} / ${formatNumber(coverage.total_messages)}`}
				/>
				<CoverageMeter
					label="Conversations covered"
					value={conversationCoveragePercent}
					detail={`${formatNumber(coverage.prompt_conversations)} / ${formatNumber(coverage.total_conversations)}`}
				/>
			</div>
			<p>
				{usedFullPeriod
					? `Digest used all ${coverage.total_messages} messages across ${coverage.total_conversations} ${conversationLabel}.`
					: `Digest sampled ${coverage.sampled_messages} of ${coverage.total_messages} messages across ${coverage.total_conversations} ${conversationLabel}.`}
			</p>
			{usedFullPeriod ? null : (
				<p className="mt-1 font-medium text-amber-700">
					Sampled context: some messages were not included in prompt excerpts.
				</p>
			)}
			<p className="mt-1">
				Prompt included{' '}
				{coverage.prompt_messages ? `${coverage.prompt_messages} message excerpts from ` : ''}
				{coverage.prompt_conversations} {promptConversationLabel}. Strategy:{' '}
				{coverage.sample_strategy}.
			</p>
			{coverage.batch_count && coverage.batch_count > 1 ? (
				<p className="mt-1">
					Local Qwen summarized {coverage.batch_messages ?? coverage.prompt_messages ?? 0} excerpts{' '}
					into {coverage.batch_count} batches. Strategy: {coverage.batch_strategy}.
				</p>
			) : null}
		</div>
	);
}

function CoverageMeter({ label, value, detail }: { label: string; value: number; detail: string }) {
	return (
		<div>
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium text-foreground">{label}</span>
				<span>{Math.round(value)}%</span>
			</div>
			<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background">
				<div className="h-full rounded-full bg-foreground" style={{ width: `${value}%` }} />
			</div>
			<div className="mt-1 text-muted-foreground">{detail}</div>
		</div>
	);
}

function percent(value: number, total: number): number {
	if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
	return Math.max(0, Math.min(100, (value / total) * 100));
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(value);
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
	const colors = {
		positive: 'bg-green-100 text-green-700',
		neutral: 'bg-gray-100 text-gray-600',
		negative: 'bg-red-100 text-red-700',
	};
	return (
		<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[sentiment]}`}>
			{sentiment}
		</span>
	);
}

function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' }) {
	const colors = {
		high: 'bg-red-100 text-red-700',
		medium: 'bg-yellow-100 text-yellow-700',
		low: 'bg-gray-100 text-gray-600',
	};
	return (
		<span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${colors[priority]}`}>
			{priority}
		</span>
	);
}

function EmptyState() {
	return (
		<div className="rounded-lg border border-border bg-muted p-12 text-center">
			<p className="text-sm text-muted-foreground">
				No digests yet. Select a period and click Generate Digest.
			</p>
		</div>
	);
}

function formatDate(date: Date | string | null): string {
	if (!date) return 'Unknown';
	const d = typeof date === 'string' ? new Date(date) : date;
	return d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

'use client';

import type { DealLocalAiStatus } from '@repo/shared';
import { Bot, Check, FileText, Lightbulb, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { generateDealLocalAiAction, updateDealAiRunStatusAction } from '@/app/actions/deals';

export interface SerializableDealAiRun {
	id: string;
	runType: string;
	status: string;
	modelRole: string;
	modelName: string;
	localVendorMode: string;
	output: string;
	uncertainty: string | null;
	sourceCount: number;
	createdAt: string;
}

interface DealLocalAiPanelProps {
	dealId: string;
	status: DealLocalAiStatus;
	initialRuns: SerializableDealAiRun[];
}

const RUN_LABELS: Record<string, string> = {
	brief: 'Brief',
	risk: 'Risk',
	next_action: 'Next Action',
	follow_up_draft: 'Follow-up Draft',
	question_answer: 'Answer',
	commitment_suggestion: 'Commitment Draft',
	stage_update_suggestion: 'Stage Draft',
};

const RUN_BUTTONS = [
	{ runType: 'brief', label: 'Generate brief', icon: FileText },
	{ runType: 'risk', label: 'Explain risks', icon: ShieldCheck },
	{ runType: 'next_action', label: 'Next actions', icon: Lightbulb },
	{ runType: 'follow_up_draft', label: 'Draft follow-up', icon: MessageSquare },
	{ runType: 'commitment_suggestion', label: 'Suggest commitment', icon: Check },
] as const;

const RECENT_RUN_LIMIT = 5;

function normalizeRun(run: unknown): SerializableDealAiRun {
	const value = run as Record<string, unknown>;
	return {
		id: String(value.id ?? ''),
		runType: String(value.runType ?? 'brief'),
		status: String(value.status ?? 'draft'),
		modelRole: String(value.modelRole ?? 'deterministic_fallback'),
		modelName: String(value.modelName ?? 'local-context-rules'),
		localVendorMode: String(value.localVendorMode ?? 'deterministic_fallback'),
		output: String(value.output ?? ''),
		uncertainty: value.uncertainty ? String(value.uncertainty) : null,
		sourceCount:
			typeof value.sourceCount === 'number' && Number.isFinite(value.sourceCount)
				? value.sourceCount
				: 0,
		createdAt:
			value.createdAt instanceof Date
				? value.createdAt.toISOString()
				: String(value.createdAt ?? new Date().toISOString()),
	};
}

function statusTone(status: DealLocalAiStatus) {
	if (status.warning) return 'border-amber-200 bg-amber-50 text-amber-900';
	if (status.chatConfigured && !status.vendorEgressEnabled)
		return 'border-emerald-200 bg-emerald-50 text-emerald-900';
	return 'border-slate-200 bg-slate-50 text-slate-800';
}

function modeCopy(status: DealLocalAiStatus) {
	if (status.warning) return status.warning;
	if (status.chatConfigured && status.liveModelEnabled) {
		return `${status.chatLabel} live calls are enabled; if the local runtime is unavailable, deal actions fall back to deterministic output.`;
	}
	if (status.chatConfigured) {
		return `${status.chatLabel} is configured, but live model calls are off. Deal actions use deterministic fallback unless live local AI is enabled.`;
	}
	if (status.vendorEgressEnabled) {
		return 'Vendor AI egress is enabled elsewhere. Deal AI still uses local or deterministic fallback paths only.';
	}
	return 'Local AI assistance is not required for this cockpit. Deterministic source-backed fallback is available.';
}

export function DealLocalAiPanel({ dealId, status, initialRuns }: DealLocalAiPanelProps) {
	const [runs, setRuns] = useState(initialRuns);
	const [question, setQuestion] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pendingLabel, setPendingLabel] = useState<string | null>(null);
	const [showAllRuns, setShowAllRuns] = useState(false);
	const [isPending, startTransition] = useTransition();
	const hiddenRunCount = Math.max(0, runs.length - RECENT_RUN_LIMIT);
	const visibleRuns = showAllRuns ? runs : runs.slice(0, RECENT_RUN_LIMIT);

	function generate(runType: string, label: string, questionText?: string) {
		setError(null);
		setPendingLabel(label);
		startTransition(async () => {
			const result = await generateDealLocalAiAction({
				dealId,
				runType: runType as
					| 'brief'
					| 'risk'
					| 'next_action'
					| 'follow_up_draft'
					| 'question_answer'
					| 'commitment_suggestion'
					| 'stage_update_suggestion',
				question: questionText,
			});
			if (result?.data) {
				setRuns((current) => [normalizeRun(result.data), ...current]);
				setQuestion('');
			} else {
				setError(result?.serverError ?? 'Unable to generate deal intelligence.');
			}
			setPendingLabel(null);
		});
	}

	function updateStatus(runId: string, nextStatus: 'accepted' | 'dismissed') {
		setError(null);
		setPendingLabel(nextStatus === 'accepted' ? 'Accepting' : 'Dismissing');
		startTransition(async () => {
			const result = await updateDealAiRunStatusAction({ runId, status: nextStatus });
			if (result?.data) {
				setRuns((current) =>
					current.map((run) => (run.id === runId ? { ...run, status: nextStatus } : run)),
				);
			} else {
				setError(result?.serverError ?? 'Unable to update suggestion status.');
			}
			setPendingLabel(null);
		});
	}

	return (
		<section
			data-testid="deal-local-ai-status"
			className="rounded-lg border border-border bg-card p-4"
		>
			<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<Bot className="h-4 w-4 text-primary" aria-hidden />
						<h2 className="text-sm font-semibold text-foreground">Local AI</h2>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Source-backed briefs, risk wording, drafts, and suggestions stay review-first.
					</p>
				</div>
				<span className="self-start rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
					Optional
				</span>
			</div>

			<div className={`mb-3 rounded-md border px-3 py-2 text-xs ${statusTone(status)}`}>
				<p className="font-medium">{modeCopy(status)}</p>
				<p className="mt-1">
					Chat: {status.chatModel}. KG: {status.embeddingModel}. Vendor egress:{' '}
					{status.vendorEgressEnabled ? 'enabled elsewhere' : 'off by default'}. Live model:{' '}
					{status.liveModelEnabled ? 'enabled' : 'off'}.
				</p>
			</div>

			<div className="mb-3 grid gap-2 sm:grid-cols-2">
				{RUN_BUTTONS.map(({ runType, label, icon: Icon }) => (
					<button
						key={runType}
						type="button"
						onClick={() => generate(runType, label)}
						disabled={isPending}
						className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
					>
						<Icon className="h-4 w-4" aria-hidden />
						<span>{isPending && pendingLabel === label ? 'Working...' : label}</span>
					</button>
				))}
			</div>

			<div className="mb-4 flex flex-col gap-2 sm:flex-row">
				<input
					value={question}
					onChange={(event) => setQuestion(event.target.value)}
					placeholder="Ask from linked evidence"
					aria-label="Ask local deal AI"
					className="min-h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
				/>
				<button
					type="button"
					onClick={() => generate('question_answer', 'Answering', question)}
					disabled={isPending || question.trim().length === 0}
					className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
				>
					<MessageSquare className="h-4 w-4" aria-hidden />
					<span>{isPending && pendingLabel === 'Answering' ? 'Working...' : 'Ask'}</span>
				</button>
			</div>

			{error ? (
				<p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{error}
				</p>
			) : null}

			<div data-testid="deal-ai-runs" className="space-y-3">
				{runs.length === 0 ? (
					<p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
						No saved deal AI output yet.
					</p>
				) : (
					<>
						{hiddenRunCount > 0 ? (
							<div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
								<span>
									{showAllRuns
										? `Showing all ${runs.length} saved outputs.`
										: `Showing ${visibleRuns.length} recent output${
												visibleRuns.length === 1 ? '' : 's'
											}.`}
								</span>
								<button
									type="button"
									onClick={() => setShowAllRuns((value) => !value)}
									className="self-start rounded px-2 py-1 font-medium text-primary hover:bg-primary/10 sm:self-auto"
								>
									{showAllRuns ? 'Show recent only' : `Show ${hiddenRunCount} older`}
								</button>
							</div>
						) : null}
						{visibleRuns.map((run) => (
							<article
								key={run.id}
								data-testid="deal-ai-run"
								className="rounded-md border border-border bg-background p-3"
							>
								<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
									<div>
										<p className="text-sm font-medium text-foreground">
											{RUN_LABELS[run.runType] ?? run.runType}
										</p>
										<p className="text-xs text-muted-foreground">
											{run.modelName} / {run.localVendorMode} / {run.sourceCount} source(s)
										</p>
									</div>
									<span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
										{run.status}
									</span>
								</div>
								<p className="whitespace-pre-wrap text-sm text-foreground">{run.output}</p>
								{run.uncertainty ? (
									<p className="mt-2 text-xs text-muted-foreground">{run.uncertainty}</p>
								) : null}
								{run.status === 'draft' ? (
									<div className="mt-3 flex flex-wrap gap-2">
										<button
											type="button"
											onClick={() => updateStatus(run.id, 'accepted')}
											disabled={isPending}
											className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
										>
											<Check className="h-3.5 w-3.5" aria-hidden />
											Accept draft
										</button>
										<button
											type="button"
											onClick={() => updateStatus(run.id, 'dismissed')}
											disabled={isPending}
											className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
										>
											<X className="h-3.5 w-3.5" aria-hidden />
											Dismiss
										</button>
									</div>
								) : null}
							</article>
						))}
					</>
				)}
			</div>
		</section>
	);
}

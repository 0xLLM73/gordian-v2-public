'use client';
// Needs interactivity: click-to-expand progressive disclosure, action buttons

import { INTRO_CONTEXT_COLORS, INTRO_STATUS_COLORS } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { IntroActions } from './intro-actions';

export interface IntroSourceEvidence {
	id: string;
	contactId: string | null;
	text: string | null;
	isOutgoing: boolean;
	sentAt: string | null;
}

interface IntroCardCollapsibleProps {
	name: string;
	introduced1Name: string;
	introduced2Name: string;
	introducerId: string;
	introduced1: string;
	introduced2: string;
	confidence: number;
	context: string;
	status: string;
	autoConfirmed: boolean | null;
	reasoning: string | null;
	note: string | null;
	detectedAt: string;
	introductionId: string;
	sourceMessageIds: string[];
	sourceEvidence: IntroSourceEvidence[];
	sourceEvidenceUnavailable: boolean;
	EditIntroButton: React.ComponentType<{
		introductionId: string;
		initialContext: string;
		initialNote: string | null;
	}>;
}

export function IntroCardCollapsible({
	name,
	introduced1Name,
	introduced2Name,
	introducerId,
	introduced1,
	introduced2,
	confidence,
	context,
	status,
	autoConfirmed,
	reasoning,
	note,
	detectedAt,
	introductionId,
	sourceMessageIds,
	sourceEvidence,
	sourceEvidenceUnavailable,
	EditIntroButton,
}: IntroCardCollapsibleProps) {
	const [expanded, setExpanded] = useState(false);
	const statusLabel = getStatusLabel(status);

	return (
		<div className="p-4">
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="flex w-full items-center justify-between text-left"
			>
				<div className="flex items-center gap-2 min-w-0">
					<p className="text-sm font-medium text-foreground truncate">
						{name} introduced {introduced1Name} to {introduced2Name}
					</p>
					{autoConfirmed ? (
						<span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
							AI detected
						</span>
					) : null}
				</div>
				<div className="flex items-center gap-2 ml-3 shrink-0">
					<span className="text-xs text-muted-foreground">{confidence}%</span>
					<span
						className={cn(
							'rounded-full px-2 py-0.5 text-[10px] font-medium',
							INTRO_STATUS_COLORS[status] || 'bg-gray-100 text-gray-500',
						)}
					>
						{statusLabel}
					</span>
					<ChevronDown
						className={cn(
							'h-4 w-4 text-muted-foreground transition-transform duration-200',
							expanded && 'rotate-180',
						)}
					/>
				</div>
			</button>

			{expanded ? (
				<div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
					<div className="flex items-center gap-2 text-sm">
						<Link href={`/contacts/${introducerId}`} className="font-medium hover:text-primary">
							{name}
						</Link>
						<span className="text-muted-foreground">introduced</span>
						<Link href={`/contacts/${introduced1}`} className="font-medium hover:text-primary">
							{introduced1Name}
						</Link>
						<span className="text-muted-foreground">to</span>
						<Link href={`/contacts/${introduced2}`} className="font-medium hover:text-primary">
							{introduced2Name}
						</Link>
					</div>

					<div className="flex items-center gap-2">
						<span
							className={cn(
								'rounded-full px-2 py-0.5 text-[10px] font-medium',
								INTRO_CONTEXT_COLORS[context] || INTRO_CONTEXT_COLORS.other,
							)}
						>
							{context}
						</span>
						<span className="text-xs text-muted-foreground">
							Detected {new Date(detectedAt).toLocaleDateString()}
						</span>
					</div>

					{reasoning ? (
						<p className="text-sm text-muted-foreground rounded bg-muted px-3 py-2">{reasoning}</p>
					) : null}

					{note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

					<SourceEvidence
						sourceMessageIds={sourceMessageIds}
						evidence={sourceEvidence}
						unavailable={sourceEvidenceUnavailable}
					/>

					<div className="flex items-center gap-1 pt-1">
						<EditIntroButton
							introductionId={introductionId}
							initialContext={context}
							initialNote={note}
						/>
						<IntroActions introductionId={introductionId} status={status} />
					</div>
				</div>
			) : null}
		</div>
	);
}

function SourceEvidence({
	sourceMessageIds,
	evidence,
	unavailable,
}: {
	sourceMessageIds: string[];
	evidence: IntroSourceEvidence[];
	unavailable: boolean;
}) {
	if (sourceMessageIds.length === 0) {
		return (
			<p className="rounded bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
				No source messages captured.
			</p>
		);
	}

	if (unavailable || evidence.length === 0) {
		return (
			<div className="rounded bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
				<p className="font-medium text-foreground">Source messages captured</p>
				<p className="mt-1">
					{sourceMessageIds.length} message
					{sourceMessageIds.length === 1 ? '' : 's'} linked. Preview text is unavailable.
				</p>
				<div className="mt-2 flex flex-wrap gap-1">
					{sourceMessageIds.slice(0, 4).map((id) => (
						<span key={id} className="rounded bg-background px-1.5 py-0.5 font-mono">
							{id.slice(0, 8)}
						</span>
					))}
				</div>
			</div>
		);
	}

	const previewedIds = new Set(evidence.map((message) => message.id));
	const missingCount = sourceMessageIds.filter((id) => !previewedIds.has(id)).length;

	return (
		<div className="rounded bg-muted/60 px-3 py-2">
			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="text-xs font-medium text-foreground">Source evidence</p>
				<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
					{evidence.length} preview{evidence.length === 1 ? '' : 's'}
				</span>
			</div>
			<div className="space-y-2">
				{evidence.map((message) => (
					<div key={message.id} className="text-xs">
						<p className="line-clamp-2 text-foreground">{message.text || '(no text)'}</p>
						<p className="mt-0.5 text-muted-foreground">
							{message.isOutgoing ? 'Outgoing' : 'Incoming'}
							{message.sentAt ? ` - ${formatEvidenceDate(message.sentAt)}` : ''}
						</p>
					</div>
				))}
			</div>
			{missingCount > 0 ? (
				<p className="mt-2 text-xs text-muted-foreground">
					{missingCount} linked source message
					{missingCount === 1 ? '' : 's'} could not be previewed.
				</p>
			) : null}
		</div>
	);
}

function getStatusLabel(status: string): string {
	if (status === 'triage') return 'needs review';
	if (status === 'active') return 'active';
	if (status === 'archive') return 'archived';
	return status;
}

function formatEvidenceDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(date);
}

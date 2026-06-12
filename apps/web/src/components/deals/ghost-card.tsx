'use client';

// Client boundary: expand/collapse state, confirm/dismiss with optimistic UI

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { confirmCandidateAction, dismissCandidateAction } from '@/app/actions/deal-candidates';

export interface GhostCandidate {
	id: string;
	dealTitleGuess: string;
	dealTypeGuess: string;
	contactId: string;
	contactName: string;
	confidence: number;
	signals: Array<{ text: string; tier: string }>;
	createdAt: Date | string;
}

const tierColors: Record<string, string> = {
	high: 'bg-green-100 text-green-700',
	medium: 'bg-yellow-100 text-yellow-700',
	low: 'bg-gray-100 text-gray-500',
};

function getConfidenceTier(confidence: number): { label: string; color: string } {
	if (confidence >= 0.8) return { label: 'High', color: 'bg-green-100 text-green-700' };
	if (confidence >= 0.5) return { label: 'Medium', color: 'bg-yellow-100 text-yellow-700' };
	return { label: 'Low', color: 'bg-gray-100 text-gray-500' };
}

export function GhostCard({
	candidate,
	onRemove,
}: {
	candidate: GhostCandidate;
	onRemove: (id: string) => void;
}) {
	const router = useRouter();
	const [expanded, setExpanded] = useState(false);
	const [isPending, startTransition] = useTransition();
	const tier = getConfidenceTier(candidate.confidence);

	function handleConfirm() {
		onRemove(candidate.id);
		startTransition(async () => {
			const result = await confirmCandidateAction({ candidateId: candidate.id });
			if (result?.serverError) {
				toast.error('Failed to confirm deal');
				router.refresh();
			} else {
				toast.success('Deal confirmed — moved to pipeline');
				router.refresh();
			}
		});
	}

	function handleDismiss() {
		onRemove(candidate.id);
		startTransition(async () => {
			const result = await dismissCandidateAction({ candidateId: candidate.id });
			if (result?.serverError) {
				toast.error('Failed to dismiss');
				router.refresh();
			} else {
				toast.success("Dismissed — similar signals from this contact won't resurface for 30 days.");
			}
		});
	}

	return (
		<div
			className={`rounded-md border border-dashed border-border bg-card p-2.5 opacity-60 transition-opacity hover:opacity-80 ${isPending ? 'pointer-events-none opacity-30' : ''}`}
		>
			<button
				type="button"
				className="w-full cursor-pointer text-left"
				onClick={() => setExpanded(!expanded)}
			>
				<div className="flex items-center gap-1.5">
					<Sparkles className="h-3.5 w-3.5 text-violet-500" />
					<p className="text-sm font-medium text-foreground">{candidate.dealTitleGuess}</p>
				</div>
				<p className="mt-0.5 text-xs text-muted-foreground">{candidate.contactName}</p>
				<div className="mt-1 flex items-center justify-between">
					<span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tier.color}`}>
						{tier.label} confidence
					</span>
					<span className="text-[10px] text-muted-foreground">
						{new Date(candidate.createdAt).toLocaleDateString()}
					</span>
				</div>
			</button>

			{expanded ? (
				<div className="mt-2 border-t border-border pt-2">
					{candidate.signals.length > 0 ? (
						<div className="mb-2 space-y-1">
							{candidate.signals.map((signal, i) => (
								<div key={`signal-${candidate.id}-${i}`} className="flex items-start gap-1.5">
									<span
										className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${tierColors[signal.tier] || 'bg-muted text-muted-foreground'}`}
									>
										{signal.tier}
									</span>
									<p className="text-xs text-muted-foreground">{signal.text}</p>
								</div>
							))}
						</div>
					) : null}

					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleConfirm}
							disabled={isPending}
							className="flex-1 rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
						>
							Confirm Deal
						</button>
						<button
							type="button"
							onClick={handleDismiss}
							disabled={isPending}
							className="flex-1 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
						>
							Dismiss
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}

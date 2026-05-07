'use client';
// Needs interactivity: confirm/dismiss buttons, dismiss popover, card animations, viewport tracking

import {
	confirmCommitmentAction,
	dismissCommitmentAction,
	getActiveCommitmentsAction,
	trackCommitmentCardEventAction,
} from '@/app/actions/commitments';
import { GuidedActionCard } from '@/components/onboarding/guided-action-card';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

interface Commitment {
	id: string;
	description: string;
	quote: string | null;
	contactName: string;
	createdAt: string | null;
	status: string;
}

type DismissReason = 'still_pending' | 'already_done' | 'not_real';

function formatSourceDate(dateStr: string | null): string {
	if (!dateStr) return '';
	const d = new Date(dateStr);
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function CommitmentsCard() {
	const [commitments, setCommitments] = useState<Commitment[]>([]);
	const [loading, setLoading] = useState(true);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [animatingOut, setAnimatingOut] = useState(false);
	const [showDismissOptions, setShowDismissOptions] = useState(false);
	const [isPending, startTransition] = useTransition();
	const [skipped, setSkipped] = useState(false);
	const [reviewedCount, setReviewedCount] = useState(0);
	const dismissRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const viewedRef = useRef(false);
	const ignoredTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
	const actedRef = useRef(false);

	useEffect(() => {
		async function load() {
			try {
				const result = await getActiveCommitmentsAction({ limit: 10 });
				if (result?.data) {
					setCommitments(
						(result.data as Array<Record<string, unknown>>).map((c) => {
							const firstName = (c.contactFirstName as string) || '';
							const lastName = (c.contactLastName as string) || '';
							const name = [firstName, lastName].filter(Boolean).join(' ');
							return {
								id: c.id as string,
								description: (c.title as string) ?? 'Untitled commitment',
								quote: (c.quote as string) || null,
								contactName: name || (c.assignee as string) || '',
								createdAt: (c.createdAt as string) || null,
								status: (c.status as string) ?? 'active',
							};
						}),
					);
				}
			} catch {
				// Non-critical — show empty state
			} finally {
				setLoading(false);
			}
		}
		load();
	}, []);

	// Close dismiss menu on outside click
	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (dismissRef.current && !dismissRef.current.contains(e.target as Node)) {
				setShowDismissOptions(false);
			}
		}
		if (showDismissOptions) {
			document.addEventListener('mousedown', handleClick);
			return () => document.removeEventListener('mousedown', handleClick);
		}
	}, [showDismissOptions]);

	// Passive dismissal: IntersectionObserver for card_viewed + 10s timer for card_ignored
	useEffect(() => {
		const current = commitments[currentIndex];
		if (!current || !cardRef.current) return;

		viewedRef.current = false;
		actedRef.current = false;
		if (ignoredTimerRef.current) clearTimeout(ignoredTimerRef.current);

		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry?.isIntersecting && !viewedRef.current) {
					viewedRef.current = true;
					trackCommitmentCardEventAction({
						commitmentId: current.id,
						event: 'commitment.card_viewed',
					}).catch(() => {});

					// Start 10s ignored timer
					ignoredTimerRef.current = setTimeout(() => {
						if (!actedRef.current) {
							trackCommitmentCardEventAction({
								commitmentId: current.id,
								event: 'commitment.card_ignored',
							}).catch(() => {});
						}
					}, 10_000);
				}
			},
			{ threshold: 0.5 },
		);

		observer.observe(cardRef.current);

		return () => {
			observer.disconnect();
			if (ignoredTimerRef.current) clearTimeout(ignoredTimerRef.current);
		};
	}, [currentIndex, commitments]);

	const advanceCard = useCallback(() => {
		actedRef.current = true;
		if (ignoredTimerRef.current) clearTimeout(ignoredTimerRef.current);
		setAnimatingOut(true);
		setTimeout(() => {
			setCurrentIndex((prev) => prev + 1);
			setReviewedCount((prev) => prev + 1);
			setAnimatingOut(false);
			setShowDismissOptions(false);
		}, 300);
	}, []);

	function handleConfirm(commitmentId: string) {
		startTransition(async () => {
			await confirmCommitmentAction({ commitmentId });
			advanceCard();
		});
	}

	function handleDismiss(commitmentId: string, reason: DismissReason) {
		startTransition(async () => {
			await dismissCommitmentAction({ commitmentId, reason });
			advanceCard();
		});
	}

	if (skipped) return null;

	const allReviewed = !loading && currentIndex >= commitments.length && commitments.length > 0;
	const current = commitments[currentIndex];
	const remaining = Math.max(0, commitments.length - currentIndex);

	return (
		<GuidedActionCard
			title="Review commitments"
			description="AI-detected promises from your conversations"
			accentColor="bg-primary"
			onSkip={() => setSkipped(true)}
		>
			{loading ? (
				<div className="space-y-2">
					{[1, 2].map((i) => (
						<div key={i} className="h-14 animate-pulse rounded bg-muted" />
					))}
				</div>
			) : commitments.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No commitments detected yet — they'll appear as more messages are analyzed.
				</p>
			) : allReviewed ? (
				<div className="flex flex-col items-center py-4 text-center">
					<div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
						<svg
							aria-hidden="true"
							className="h-5 w-5 text-success"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
						</svg>
					</div>
					<p className="text-sm font-medium text-foreground">All reviewed</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{reviewedCount} commitment{reviewedCount !== 1 ? 's' : ''} reviewed. Your feedback
						improves future detection.
					</p>
				</div>
			) : current ? (
				<div className="relative">
					{/* Progress indicator */}
					<div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
						<span>
							{currentIndex + 1} of {commitments.length}
						</span>
						<span>{remaining} remaining</span>
					</div>

					{/* Current card */}
					<div
						ref={cardRef}
						className={cn(
							'rounded-md border border-border p-3 transition-all duration-300',
							animatingOut && 'translate-x-4 opacity-0',
						)}
					>
						{/* Quote (source text) */}
						{current.quote ? (
							<p className="mb-1.5 text-xs italic text-muted-foreground border-l-2 border-muted pl-2">
								&ldquo;{current.quote}&rdquo;
							</p>
						) : null}

						{/* Commitment title */}
						<p className="text-sm text-foreground">{current.description}</p>

						{/* Source attribution */}
						{current.contactName ? (
							<p className="mt-1 text-xs text-muted-foreground">
								From conversation with {current.contactName}
								{current.createdAt ? `, ${formatSourceDate(current.createdAt)}` : ''}
							</p>
						) : null}

						<div className="mt-3 flex items-center gap-2">
							{/* Confirm button */}
							<button
								type="button"
								disabled={isPending}
								onClick={() => handleConfirm(current.id)}
								className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-50"
							>
								<svg
									aria-hidden="true"
									className="h-3.5 w-3.5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={2.5}
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"
									/>
								</svg>
								Confirm
							</button>

							{/* Dismiss button with dropdown */}
							<div className="relative" ref={dismissRef}>
								<button
									type="button"
									disabled={isPending}
									onClick={() => setShowDismissOptions(!showDismissOptions)}
									className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
								>
									<svg
										aria-hidden="true"
										className="h-3.5 w-3.5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										strokeWidth={2.5}
									>
										<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
									Dismiss
								</button>

								{showDismissOptions ? (
									<div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95">
										<button
											type="button"
											disabled={isPending}
											onClick={() => handleDismiss(current.id, 'still_pending')}
											className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
										>
											<span className="mt-0.5 shrink-0 text-muted-foreground">~</span>
											<div>
												<span className="font-medium text-foreground">Still pending</span>
												<p className="mt-0.5 text-muted-foreground">
													Keep active, I haven't acted on it yet
												</p>
											</div>
										</button>
										<button
											type="button"
											disabled={isPending}
											onClick={() => handleDismiss(current.id, 'already_done')}
											className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
										>
											<span className="mt-0.5 shrink-0 text-success">&#10003;</span>
											<div>
												<span className="font-medium text-foreground">I already did this</span>
												<p className="mt-0.5 text-muted-foreground">Mark as fulfilled</p>
											</div>
										</button>
										<button
											type="button"
											disabled={isPending}
											onClick={() => handleDismiss(current.id, 'not_real')}
											className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
										>
											<span className="mt-0.5 shrink-0 text-destructive">&#10005;</span>
											<div>
												<span className="font-medium text-foreground">Not a real commitment</span>
												<p className="mt-0.5 text-muted-foreground">
													AI got this wrong — helps improve detection
												</p>
											</div>
										</button>
									</div>
								) : null}
							</div>
						</div>
					</div>
				</div>
			) : null}
		</GuidedActionCard>
	);
}

'use client';

import {
	getCalibrationSamplesAction,
	submitCalibrationFeedbackAction,
} from '@/app/actions/style-calibration';
import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAbandonTracking } from '@/hooks/use-abandon-tracking';
import { useStepTracking } from '@/hooks/use-step-tracking';
import { Loader2, Pencil, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const ARM_LABELS: Record<string, string> = {
	casual_nudge: 'Casual',
	professional_value: 'Professional',
	direct_ask: 'Direct',
	soft_memory: 'Soft',
};

const REJECTION_REASONS = [
	'Too formal',
	'Too casual',
	'Too long',
	"Doesn't sound like me",
] as const;

interface Reaction {
	action: 'approve' | 'reject' | 'edit';
	editedText?: string;
	reason?: string;
}

type Sample = {
	text: string;
	armType: 'casual_nudge' | 'professional_value' | 'direct_ask' | 'soft_memory';
};

export default function CalibratePage() {
	const router = useRouter();
	const { workspaceId, hydrated } = useOnboarding();
	const fetchedRef = useRef(false);

	const [samples, setSamples] = useState<Sample[]>([]);
	const [reactions, setReactions] = useState<Record<number, Reaction>>({});
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [step, setStep] = useState<'loading' | 'rating' | 'error'>('loading');
	useAbandonTracking('calibrate', workspaceId);
	const completeStep = useStepTracking('calibrate', workspaceId);

	// Redirect if no workspace
	useEffect(() => {
		if (!hydrated) return;
		if (!workspaceId) {
			router.replace('/onboarding/connect');
		}
	}, [hydrated, workspaceId, router]);

	// Fetch samples once on mount
	useEffect(() => {
		if (!workspaceId || fetchedRef.current) return;
		fetchedRef.current = true;

		getCalibrationSamplesAction({})
			.then((result) => {
				if (result?.data?.alreadyCalibrated) {
					router.replace('/onboarding/first-look');
					return;
				}
				if (result?.data?.samples && result.data.samples.length > 0) {
					setSamples(result.data.samples);
					setStep('rating');
				} else {
					setStep('error');
				}
			})
			.catch(() => {
				setStep('error');
			});
	}, [workspaceId, router]);

	const setReaction = (index: number, reaction: Reaction) => {
		setReactions((prev) => ({ ...prev, [index]: reaction }));
	};

	const handleApprove = (index: number) => {
		setReaction(index, { action: 'approve' });
		if (editingIndex === index) setEditingIndex(null);
	};

	const handleReject = (index: number) => {
		setReaction(index, { action: 'reject' });
		if (editingIndex === index) setEditingIndex(null);
	};

	const handleEdit = (index: number) => {
		setEditingIndex(index);
		setReaction(index, {
			action: 'edit',
			editedText: reactions[index]?.editedText ?? samples[index]?.text ?? '',
		});
	};

	const handleReasonSelect = (index: number, reason: string) => {
		setReaction(index, { ...reactions[index], action: 'reject', reason });
	};

	const handleEditedTextChange = (index: number, text: string) => {
		setReaction(index, { ...reactions[index], action: 'edit', editedText: text });
	};

	const handleSubmit = async () => {
		setIsSubmitting(true);
		try {
			const reactionArray = Object.entries(reactions).map(([idx, r]) => ({
				armType: samples[Number(idx)]?.armType ?? 'casual_nudge',
				action: r.action,
				editedText: r.action === 'edit' ? r.editedText : undefined,
				reason: r.action === 'reject' ? r.reason : undefined,
			}));

			const result = await submitCalibrationFeedbackAction({ reactions: reactionArray });
			if (!result?.data?.calibrated) {
				setStep('error');
				return;
			}
		} catch {
			setStep('error');
			return;
		} finally {
			setIsSubmitting(false);
		}
		completeStep();
		router.push('/onboarding/first-look');
	};

	const handleSkip = async () => {
		setIsSubmitting(true);
		try {
			await submitCalibrationFeedbackAction({ reactions: [] });
		} catch {
			// Skip is best-effort — proceed even on failure
		} finally {
			setIsSubmitting(false);
		}
		completeStep();
		router.push('/onboarding/first-look');
	};

	if (!hydrated || !workspaceId) return null;

	const reactionCount = Object.keys(reactions).length;

	return (
		<OnboardingCard className="max-w-2xl">
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">How do you write?</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Rate these AI-generated sample messages so drafts sound more like you.
				</p>
			</div>

			{step === 'loading' && (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="size-6 animate-spin text-muted-foreground" />
				</div>
			)}

			{step === 'error' && (
				<div className="flex flex-col items-center gap-4 py-12">
					<p className="text-sm text-muted-foreground">
						Couldn't load calibration samples. You can skip this step and calibrate later.
					</p>
					<Button onClick={handleSkip} disabled={isSubmitting}>
						{isSubmitting ? (
							<>
								<Loader2 className="mr-2 size-4 animate-spin" />
								Skipping...
							</>
						) : (
							'Skip for now'
						)}
					</Button>
				</div>
			)}

			{step === 'rating' && (
				<>
					<div className="space-y-4 max-h-[50vh] overflow-y-auto">
						{samples.map((sample, index) => (
							<div
								key={`${sample.armType}-${index}`}
								className="rounded-lg border border-border bg-card p-4 space-y-3"
							>
								<div className="flex items-center justify-between">
									<span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
										{ARM_LABELS[sample.armType] ?? sample.armType}
									</span>
									<div className="flex gap-1">
										<Button
											variant={reactions[index]?.action === 'approve' ? 'default' : 'ghost'}
											size="icon"
											className="size-8"
											onClick={() => handleApprove(index)}
											aria-label="Approve"
										>
											<ThumbsUp className="size-4" />
										</Button>
										<Button
											variant={reactions[index]?.action === 'reject' ? 'destructive' : 'ghost'}
											size="icon"
											className="size-8"
											onClick={() => handleReject(index)}
											aria-label="Reject"
										>
											<ThumbsDown className="size-4" />
										</Button>
										<Button
											variant={editingIndex === index ? 'secondary' : 'ghost'}
											size="icon"
											className="size-8"
											onClick={() => handleEdit(index)}
											aria-label="Edit"
										>
											<Pencil className="size-4" />
										</Button>
									</div>
								</div>

								{editingIndex === index ? (
									<Textarea
										value={reactions[index]?.editedText ?? sample.text}
										onChange={(e) => handleEditedTextChange(index, e.target.value)}
										maxLength={4000}
										rows={3}
										className="resize-none"
									/>
								) : (
									<p className="text-sm whitespace-pre-wrap">{sample.text}</p>
								)}

								{reactions[index]?.action === 'reject' && (
									<div className="flex flex-wrap gap-2">
										{REJECTION_REASONS.map((reason) => (
											<Button
												key={reason}
												variant={reactions[index]?.reason === reason ? 'secondary' : 'outline'}
												size="sm"
												className="text-xs"
												onClick={() => handleReasonSelect(index, reason)}
											>
												{reason}
											</Button>
										))}
									</div>
								)}
							</div>
						))}
					</div>

					<div className="mt-6 flex justify-between">
						<Button variant="outline" onClick={handleSkip} disabled={isSubmitting}>
							Skip
						</Button>
						<Button onClick={handleSubmit} disabled={reactionCount === 0 || isSubmitting}>
							{isSubmitting ? (
								<>
									<Loader2 className="mr-2 size-4 animate-spin" />
									Submitting...
								</>
							) : (
								'Continue'
							)}
						</Button>
					</div>
				</>
			)}
		</OnboardingCard>
	);
}

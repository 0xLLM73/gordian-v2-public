// 'use client' — needs useState, useEffect, event handlers for interactive calibration flow
'use client';

import {
	getCalibrationSamplesAction,
	submitCalibrationFeedbackAction,
} from '@/app/actions/style-calibration';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Pencil, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';

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

export interface StyleCalibrationProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onComplete: () => void;
}

export function StyleCalibration({ open, onOpenChange, onComplete }: StyleCalibrationProps) {
	const [samples, setSamples] = useState<
		Array<{
			text: string;
			armType: 'casual_nudge' | 'professional_value' | 'direct_ask' | 'soft_memory';
		}>
	>([]);
	const [reactions, setReactions] = useState<Record<number, Reaction>>({});
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [step, setStep] = useState<'loading' | 'rating' | 'done'>('loading');

	useEffect(() => {
		if (!open) return;
		setStep('loading');
		setReactions({});
		setEditingIndex(null);

		getCalibrationSamplesAction({}).then((result) => {
			if (result?.data?.alreadyCalibrated) {
				onComplete();
				return;
			}
			if (result?.data?.samples) {
				setSamples(result.data.samples);
				setStep('rating');
			}
		});
	}, [open, onComplete]);

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
		const reactionArray = Object.entries(reactions).map(([idx, r]) => ({
			armType: samples[Number(idx)]?.armType ?? 'casual_nudge',
			action: r.action,
			editedText: r.action === 'edit' ? r.editedText : undefined,
			reason: r.action === 'reject' ? r.reason : undefined,
		}));

		const result = await submitCalibrationFeedbackAction({ reactions: reactionArray });
		setIsSubmitting(false);
		if (result?.data?.calibrated) {
			setStep('done');
			onComplete();
			onOpenChange(false);
		}
	};

	const handleSkip = async () => {
		setIsSubmitting(true);
		await submitCalibrationFeedbackAction({ reactions: [] });
		setIsSubmitting(false);
		setStep('done');
		onComplete();
		onOpenChange(false);
	};

	const reactionCount = Object.keys(reactions).length;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>How do you write?</DialogTitle>
					<DialogDescription>
						Rate these AI-generated sample messages so drafts sound more like you.
					</DialogDescription>
				</DialogHeader>

				{step === 'loading' ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : null}

				{step === 'rating' ? (
					<div className="space-y-4 max-h-[60vh] overflow-y-auto">
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

								{reactions[index]?.action === 'reject' ? (
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
								) : null}
							</div>
						))}
					</div>
				) : null}

				{step === 'rating' ? (
					<DialogFooter>
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
								'Submit'
							)}
						</Button>
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

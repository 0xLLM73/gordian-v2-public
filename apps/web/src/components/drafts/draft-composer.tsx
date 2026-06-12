'use client';

import { useEffect, useRef, useState } from 'react';
import { discardDraftAction, generateDraftAction, sendDraftAction } from '@/app/actions/drafts';
import { getCalibrationSamplesAction } from '@/app/actions/style-calibration';
import { StyleCalibration } from '@/components/onboarding/style-calibration';

const ARM_LABELS: Record<string, string> = {
	casual_nudge: 'Casual',
	professional_value: 'Professional',
	direct_ask: 'Direct',
	soft_memory: 'Memory',
};

export function DraftComposer({ contactId }: { contactId: string }) {
	const [draft, setDraft] = useState<{
		id: string;
		text: string;
		armType: string;
		traceId: string;
	} | null>(null);
	const [editedText, setEditedText] = useState('');
	const [isGenerating, setIsGenerating] = useState(false);
	const [isMarkingSent, setIsMarkingSent] = useState(false);
	const [showCalibration, setShowCalibration] = useState(false);
	const calibrationChecked = useRef(false);

	useEffect(() => {
		if (calibrationChecked.current) return;
		calibrationChecked.current = true;
		getCalibrationSamplesAction({})
			.then((result) => {
				if (result?.data && !result.data.alreadyCalibrated) {
					setShowCalibration(true);
				}
			})
			.catch(() => {});
	}, []);

	const handleGenerate = async () => {
		setIsGenerating(true);
		try {
			const result = await generateDraftAction({ contactId });
			if (result?.data) {
				setDraft({
					id: result.data.draftId ?? '',
					text: result.data.text,
					armType: result.data.armType,
					traceId: result.data.traceId,
				});
				setEditedText(result.data.text);
			}
		} finally {
			setIsGenerating(false);
		}
	};

	const handleSend = async () => {
		if (!draft) return;
		setIsMarkingSent(true);
		try {
			await sendDraftAction({
				draftId: draft.id,
				editedText,
				originalText: draft.text,
				traceId: draft.traceId,
			});
			setDraft(null);
			setEditedText('');
		} finally {
			setIsMarkingSent(false);
		}
	};

	const handleDiscard = async () => {
		if (!draft) return;
		await discardDraftAction({ draftId: draft.id, traceId: draft.traceId });
		setDraft(null);
		setEditedText('');
	};

	if (!draft) {
		return (
			<div className="rounded-lg border border-border bg-card p-4">
				<h3 className="mb-3 text-sm font-semibold text-foreground">Message Draft</h3>
				<button
					type="button"
					onClick={handleGenerate}
					disabled={isGenerating}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
				>
					{isGenerating ? 'Generating...' : 'Generate Draft'}
				</button>
				<StyleCalibration
					open={showCalibration}
					onOpenChange={setShowCalibration}
					onComplete={() => setShowCalibration(false)}
				/>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">Message Draft</h3>
				<span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-primary">
					{ARM_LABELS[draft.armType] || draft.armType}
				</span>
			</div>
			<textarea
				value={editedText}
				onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditedText(e.target.value)}
				className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
				rows={4}
				maxLength={4000}
			/>
			<div className="mt-2 flex items-center justify-between">
				<p className="text-xs text-muted-foreground">{editedText.length}/4000</p>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={handleDiscard}
						className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
					>
						Discard
					</button>
					<button
						type="button"
						onClick={handleGenerate}
						disabled={isGenerating}
						className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-50"
					>
						{isGenerating ? '...' : 'Regenerate'}
					</button>
					<button
						type="button"
						onClick={handleSend}
						disabled={isMarkingSent || editedText.trim().length === 0}
						className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
					>
						{isMarkingSent ? 'Marking...' : 'Mark sent'}
					</button>
				</div>
			</div>
		</div>
	);
}

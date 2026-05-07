'use client';

import { Button } from '@/components/ui/button';
import { Check, Loader2, Send, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';

export interface ActionProposal {
	action:
		| 'create_commitment'
		| 'update_deal_stage'
		| 'draft_message'
		| 'create_deal'
		| 'create_goal';
	data: Record<string, unknown>;
	status: 'pending' | 'confirmed' | 'cancelled' | 'executing';
}

interface ActionCardProps {
	proposal: ActionProposal;
	onConfirm: () => Promise<void>;
	onCancel: () => void;
}

function getProposalLabel(proposal: ActionProposal): React.ReactNode {
	const { action, data } = proposal;

	if (action === 'create_commitment') {
		const title = data.title as string;
		const contactName = data.contactName as string;
		const commitmentType = data.commitmentType as string;
		return (
			<span>
				Create commitment: <strong className="font-medium">{title}</strong>
				{' for '}
				<strong className="font-medium">{contactName}</strong>
				{' ('}
				{commitmentType}
				{')'}
			</span>
		);
	}

	if (action === 'update_deal_stage') {
		const dealTitle = data.dealTitle as string;
		const currentStage = data.currentStage as string;
		const newStage = data.newStage as string;
		return (
			<span>
				Move <strong className="font-medium">{dealTitle}</strong>:{' '}
				<span className="text-muted-foreground">{currentStage}</span>
				{' → '}
				<strong className="font-medium">{newStage}</strong>
			</span>
		);
	}

	if (action === 'create_deal') {
		const title = data.title as string;
		const contactName = data.contactName as string;
		const dealType = data.dealType as string;
		const value = data.value as number | undefined;
		return (
			<span>
				Create deal: <strong className="font-medium">{title}</strong>
				{' with '}
				<strong className="font-medium">{contactName}</strong>
				{' ('}
				{dealType}
				{value ? `, $${value.toLocaleString()}` : ''}
				{')'}
			</span>
		);
	}

	if (action === 'create_goal') {
		const type = data.type as string;
		const title = data.title as string;
		const targetCount = data.targetCount as number;
		const targetDate = data.targetDate as string | undefined;
		return (
			<span>
				Create {type} goal: <strong className="font-medium">{title}</strong>
				{' (target: '}
				{targetCount}
				{targetDate ? `, by ${targetDate}` : ''}
				{')'}
			</span>
		);
	}

	if (action === 'draft_message') {
		const contactName = data.contactName as string;
		const draftText = data.draftText as string;
		return (
			<span>
				<span>
					Draft message for <strong className="font-medium">{contactName}</strong>:
				</span>
				<blockquote className="mt-1 border-l-2 border-border pl-3 text-muted-foreground italic">
					{draftText}
				</blockquote>
			</span>
		);
	}

	return <span>Proposed action</span>;
}

export function ActionCard({ proposal, onConfirm, onCancel }: ActionCardProps) {
	const [localStatus, setLocalStatus] = useState<ActionProposal['status']>(proposal.status);
	const [confirmInput, setConfirmInput] = useState('');

	const isDraftMessage = proposal.action === 'draft_message';
	const requiredName = isDraftMessage ? (proposal.data.contactName as string).split(/\s+/)[0] : '';
	const nameMatches = confirmInput.trim().toLowerCase() === requiredName.toLowerCase();

	const handleConfirm = async () => {
		setLocalStatus('executing');
		try {
			await onConfirm();
			setLocalStatus('confirmed');
		} catch {
			setLocalStatus('pending');
		}
	};

	const handleCancel = () => {
		setLocalStatus('cancelled');
		onCancel();
	};

	return (
		<div className="bg-card border border-border rounded-lg p-3 mt-2">
			<div className="text-sm text-foreground">{getProposalLabel(proposal)}</div>

			{localStatus === 'pending' && isDraftMessage ? (
				<div className="mt-3 space-y-2">
					<div className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
						<TriangleAlert className="h-3.5 w-3.5" />
						This will send a real message on Telegram
					</div>
					<div>
						<label className="text-xs text-muted-foreground" htmlFor="confirm-name">
							Type <strong>{requiredName}</strong> to confirm
						</label>
						<input
							id="confirm-name"
							type="text"
							value={confirmInput}
							onChange={(e) => setConfirmInput(e.target.value)}
							className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
							placeholder={requiredName}
						/>
					</div>
					<div className="flex gap-2">
						<Button
							type="button"
							size="sm"
							className="h-7 gap-1 bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
							disabled={!nameMatches}
							onClick={handleConfirm}
						>
							<Send className="h-3.5 w-3.5" />
							Send via Telegram
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 gap-1"
							onClick={handleCancel}
						>
							<X className="h-3.5 w-3.5" />
							Cancel
						</Button>
					</div>
				</div>
			) : localStatus === 'pending' ? (
				<div className="mt-2 flex gap-2">
					<Button
						type="button"
						size="sm"
						variant="default"
						className="h-7 gap-1 bg-green-600 hover:bg-green-700 text-white"
						onClick={handleConfirm}
					>
						<Check className="h-3.5 w-3.5" />
						Confirm
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 gap-1"
						onClick={handleCancel}
					>
						<X className="h-3.5 w-3.5" />
						Cancel
					</Button>
				</div>
			) : null}

			{localStatus === 'executing' && (
				<div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					{isDraftMessage ? 'Sending...' : 'Executing...'}
				</div>
			)}

			{localStatus === 'confirmed' && (
				<div className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
					<Check className="h-3.5 w-3.5" />
					{isDraftMessage ? 'Sent' : 'Done'}
				</div>
			)}

			{localStatus === 'cancelled' && (
				<div className="mt-2 text-xs text-muted-foreground line-through">Cancelled</div>
			)}
		</div>
	);
}

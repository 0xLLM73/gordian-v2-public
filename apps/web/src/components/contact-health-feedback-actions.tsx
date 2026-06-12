'use client';

import type { ContactHealthFeedbackAction } from '@repo/db';
import { CheckCircle2, Clock3, EyeOff, MessageCircleOff, ThumbsDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { recordContactHealthFeedbackAction } from '@/app/actions/contact-health-feedback';

const ACTION_META: Record<
	ContactHealthFeedbackAction,
	{
		label: string;
		success: string;
		icon: typeof Clock3;
	}
> = {
	snooze: {
		label: 'Snooze',
		success: 'Snoozed',
		icon: Clock3,
	},
	mark_low_touch: {
		label: 'Low-touch',
		success: 'Marked low-touch',
		icon: CheckCircle2,
	},
	handled_elsewhere: {
		label: 'Handled',
		success: 'Marked handled',
		icon: MessageCircleOff,
	},
	not_important: {
		label: 'Not important',
		success: 'Marked not important',
		icon: EyeOff,
	},
	dismiss_wrong: {
		label: 'Wrong',
		success: 'Dismissed',
		icon: ThumbsDown,
	},
};

interface ContactHealthFeedbackActionsProps {
	actions?: ContactHealthFeedbackAction[];
	contactId: string;
	statusReasonCode?: string | null;
}

export function ContactHealthFeedbackActions({
	actions = ['snooze', 'mark_low_touch', 'handled_elsewhere', 'not_important'],
	contactId,
	statusReasonCode,
}: ContactHealthFeedbackActionsProps) {
	const router = useRouter();
	const [selectedAction, setSelectedAction] = useState<ContactHealthFeedbackAction | null>(null);
	const [isPending, startTransition] = useTransition();

	function handleAction(action: ContactHealthFeedbackAction) {
		startTransition(async () => {
			try {
				const result = await recordContactHealthFeedbackAction({
					contactId,
					action,
					statusReasonCode: statusReasonCode ?? undefined,
				});
				if (result?.serverError || result?.validationErrors) {
					toast.error('Could not save feedback');
					return;
				}
				setSelectedAction(action);
				toast.success(ACTION_META[action].success);
				router.refresh();
			} catch {
				toast.error('Could not save feedback');
			}
		});
	}

	if (selectedAction) {
		return (
			<p className="text-xs font-medium text-muted-foreground">
				{ACTION_META[selectedAction].success}
			</p>
		);
	}

	return (
		<div className="flex flex-wrap gap-1.5">
			{actions.map((action) => {
				const meta = ACTION_META[action];
				const Icon = meta.icon;
				return (
					<button
						key={action}
						type="button"
						disabled={isPending}
						onClick={() => handleAction(action)}
						className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
					>
						<Icon className="h-3 w-3" aria-hidden="true" />
						{meta.label}
					</button>
				);
			})}
		</div>
	);
}

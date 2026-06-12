'use client';

import * as React from 'react';
import { createFollowUpPlanTemplateFromPlanAction } from '@/app/actions/follow-up-plans';

export function SavePlanTemplateAction({ followUpPlanId }: { followUpPlanId: string }) {
	const [pending, setPending] = React.useState(false);
	const [message, setMessage] = React.useState<string | null>(null);

	async function handleSaveTemplate() {
		if (pending) return;
		setPending(true);
		setMessage(null);
		try {
			const result = await createFollowUpPlanTemplateFromPlanAction({ followUpPlanId });
			if (result?.data) {
				const version = typeof result.data.version === 'number' ? ` v${result.data.version}` : '';
				setMessage(`Saved local template${version}.`);
			} else {
				setMessage('Could not save this plan as a template.');
			}
		} catch {
			setMessage('Could not save this plan as a template.');
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="flex flex-col items-end gap-1">
			<button
				type="button"
				onClick={handleSaveTemplate}
				disabled={pending}
				className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
			>
				{pending ? 'Saving...' : 'Save as template'}
			</button>
			{message ? <p className="text-right text-xs text-muted-foreground">{message}</p> : null}
		</div>
	);
}

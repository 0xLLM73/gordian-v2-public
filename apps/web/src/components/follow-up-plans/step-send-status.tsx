export interface FollowUpPlanSendRecordView {
	status: string;
	channel?: string | null;
	copiedAt?: Date | string | null;
	telegramOpenedAt?: Date | string | null;
	manualConfirmedAt?: Date | string | null;
	createdAt?: Date | string | null;
}

function toDate(value: Date | string | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value: Date | string | null | undefined) {
	const date = toDate(value);
	return date ? date.toLocaleString() : null;
}

function recordTime(record: FollowUpPlanSendRecordView) {
	return (
		toDate(record.manualConfirmedAt) ??
		toDate(record.telegramOpenedAt) ??
		toDate(record.copiedAt) ??
		toDate(record.createdAt) ??
		new Date(0)
	);
}

function latestSendRecord(records: FollowUpPlanSendRecordView[]) {
	return [...records].sort((a, b) => recordTime(b).getTime() - recordTime(a).getTime())[0] ?? null;
}

export function getFollowUpStepSendStatus(records: FollowUpPlanSendRecordView[]) {
	const latest = latestSendRecord(records);
	if (!latest) {
		return {
			label: 'No send action yet',
			detail: 'Copy or open Telegram only when you are ready to send manually.',
			tone: 'neutral' as const,
		};
	}

	if (latest.status === 'manual_confirmed') {
		return {
			label: 'Manual send confirmed',
			detail: formatDateTime(latest.manualConfirmedAt ?? latest.createdAt) ?? 'Recorded manually.',
			tone: 'ok' as const,
		};
	}

	if (latest.status === 'telegram_opened') {
		return {
			label: 'Telegram opened, not confirmed',
			detail:
				formatDateTime(latest.telegramOpenedAt ?? latest.createdAt) ??
				'Confirm manual sending after you send the draft.',
			tone: 'warn' as const,
		};
	}

	if (latest.status === 'copied') {
		return {
			label: 'Draft copied, not confirmed',
			detail:
				formatDateTime(latest.copiedAt ?? latest.createdAt) ??
				'Confirm manual sending after you send the draft.',
			tone: 'warn' as const,
		};
	}

	if (latest.status === 'skipped') {
		return {
			label: 'Skipped',
			detail: formatDateTime(latest.createdAt) ?? 'This step was skipped.',
			tone: 'muted' as const,
		};
	}

	return {
		label: latest.status.replaceAll('_', ' '),
		detail: formatDateTime(latest.createdAt) ?? 'Recorded send activity.',
		tone: 'neutral' as const,
	};
}

function toneClasses(tone: ReturnType<typeof getFollowUpStepSendStatus>['tone']) {
	if (tone === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
	if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-950';
	if (tone === 'muted') return 'border-slate-200 bg-slate-50 text-slate-700';
	return 'border-border bg-muted/40 text-muted-foreground';
}

export function StepSendStatus({ records }: { records: FollowUpPlanSendRecordView[] }) {
	const status = getFollowUpStepSendStatus(records);
	return (
		<div className={`mt-2 rounded-md border px-3 py-2 text-xs ${toneClasses(status.tone)}`}>
			<p className="font-medium">{status.label}</p>
			<p className="mt-1">{status.detail}</p>
			{status.tone === 'warn' ? (
				<p className="mt-1 font-medium">
					Not marked sent. The plan will not advance until you confirm.
				</p>
			) : null}
		</div>
	);
}

export interface StepProcessingStatusProps {
	status: string;
	lastProcessingError?: string | null;
	processingLeaseExpiresAt?: Date | string | null;
	now?: Date | string;
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

function retryText(value: Date | string | null | undefined, now: Date) {
	const retryAt = toDate(value);
	if (!retryAt) return 'Retryable when the local worker runs again.';
	if (retryAt.getTime() <= now.getTime()) return 'Retryable now when the local worker runs.';
	return `Retry after ${retryAt.toLocaleString()}.`;
}

export function StepProcessingStatus({
	status,
	lastProcessingError,
	processingLeaseExpiresAt,
	now,
}: StepProcessingStatusProps) {
	const currentTime = toDate(now) ?? new Date();
	const leaseExpiresAt = toDate(processingLeaseExpiresAt);
	const hasActiveLease =
		status === 'ready' && leaseExpiresAt && leaseExpiresAt.getTime() > currentTime.getTime();
	const error = lastProcessingError?.trim();

	if (!error && !hasActiveLease) return null;

	if (error) {
		return (
			<div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
				<p className="font-medium">Draft generation blocked</p>
				<p className="mt-1">Last worker error: {error}</p>
				<p className="mt-1 font-medium">{retryText(leaseExpiresAt, currentTime)}</p>
				<p className="mt-1">
					The draft was not sent. You can reschedule, switch to template-only guidance, or wait for
					the local worker to retry.
				</p>
			</div>
		);
	}

	return (
		<div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
			<p className="font-medium">Draft generation in progress</p>
			<p className="mt-1">
				A local worker claimed this step. If the app stopped, it becomes retryable after{' '}
				{formatDateTime(leaseExpiresAt) ?? 'the processing lease expires'}.
			</p>
			<p className="mt-1 font-medium">No message has been sent.</p>
		</div>
	);
}

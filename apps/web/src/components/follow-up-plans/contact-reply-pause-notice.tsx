export interface FollowUpPlanActivityEventLike {
	eventType: string;
	summary: string;
	metadata?: unknown;
	createdAt?: Date | string | null;
}

function metadataReason(metadata: unknown) {
	if (!metadata || typeof metadata !== 'object') return null;
	const reason = (metadata as Record<string, unknown>).reason;
	return typeof reason === 'string' ? reason : null;
}

function formatDateTime(value: Date | string | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleString();
}

export function findContactReplyPauseEvent(events: FollowUpPlanActivityEventLike[]) {
	return events.find(
		(event) =>
			event.eventType === 'plan_paused' && metadataReason(event.metadata) === 'contact_replied',
	);
}

export function ContactReplyPauseNotice({
	planStatus,
	contactName,
	activityEvents,
}: {
	planStatus: string;
	contactName: string | null;
	activityEvents: FollowUpPlanActivityEventLike[];
}) {
	const pauseEvent =
		planStatus === 'paused' ? findContactReplyPauseEvent(activityEvents) : undefined;
	if (!pauseEvent) return null;

	const pausedAt = formatDateTime(pauseEvent.createdAt);
	const resolvedContactName = contactName ?? 'the contact';

	return (
		<div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="text-xs font-medium uppercase text-amber-800">Contact replied</p>
					<h2 className="mt-1 text-base font-semibold">
						Plan paused because {resolvedContactName} replied.
					</h2>
				</div>
				{pausedAt ? (
					<span className="w-fit rounded-full bg-white px-2 py-0.5 text-xs font-medium text-amber-800">
						{pausedAt}
					</span>
				) : null}
			</div>
			<p className="mt-2 text-sm text-amber-900">
				Review the latest local messages before resuming. Paused plans do not generate new drafts,
				and no message has been sent automatically.
			</p>
			<p className="mt-2 text-xs text-amber-800">{pauseEvent.summary}</p>
		</div>
	);
}

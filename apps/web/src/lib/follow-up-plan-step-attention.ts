export type FollowUpPlanStepAttentionTone = 'neutral' | 'ok' | 'warn' | 'danger';

export interface FollowUpPlanStepAttention {
	status:
		| 'needs_review'
		| 'blocked'
		| 'generating'
		| 'overdue'
		| 'ready'
		| 'scheduled'
		| 'done'
		| 'idle';
	label: string;
	detail: string;
	tone: FollowUpPlanStepAttentionTone;
}

export interface FollowUpPlanStepAttentionInput {
	status: string;
	scheduledAt?: Date | string | null;
	draftText?: string | null;
	lastProcessingError?: string | null;
	processingLeaseExpiresAt?: Date | string | null;
	sentAt?: Date | string | null;
}

function toDate(value: Date | string | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: Date | string | null | undefined) {
	const date = toDate(value);
	return date ? date.toLocaleDateString() : null;
}

function publicProcessingError(value: string) {
	const summary = value.trim().slice(0, 220);
	if (!summary) return 'Draft generation failed.';
	if (/(failed query|params:|select |insert |update |delete | from ")/i.test(summary)) {
		return 'Worker database query failed.';
	}
	return summary;
}

function isLocalAiError(value: string) {
	return /\b(ai|ollama|qwen|model|local runtime|local llm)\b/i.test(value);
}

export function getFollowUpPlanStepAttention(
	step: FollowUpPlanStepAttentionInput,
	now: Date = new Date(),
): FollowUpPlanStepAttention {
	const error = step.lastProcessingError?.trim();
	const leaseExpiresAt = toDate(step.processingLeaseExpiresAt);
	const scheduledAt = toDate(step.scheduledAt);

	if (step.status === 'pending_review' && step.draftText?.trim()) {
		return {
			status: 'needs_review',
			label: 'Draft ready for review',
			detail: 'Local draft waiting. Not sent.',
			tone: 'warn',
		};
	}

	if (error) {
		const retryReady = !leaseExpiresAt || leaseExpiresAt.getTime() <= now.getTime();
		return {
			status: 'blocked',
			label: isLocalAiError(error) ? 'Local AI blocked' : 'Draft generation blocked',
			detail: `${publicProcessingError(error)} ${retryReady ? 'Retryable when the local worker runs.' : `Retry after ${leaseExpiresAt.toLocaleString()}.`}`,
			tone: 'danger',
		};
	}

	if (step.status === 'ready' && leaseExpiresAt && leaseExpiresAt.getTime() > now.getTime()) {
		return {
			status: 'generating',
			label: 'Generating locally',
			detail: `Worker lease expires ${leaseExpiresAt.toLocaleString()} if interrupted.`,
			tone: 'warn',
		};
	}

	if (step.status === 'ready') {
		if (scheduledAt && scheduledAt.getTime() <= now.getTime()) {
			return {
				status: 'overdue',
				label: 'Due now',
				detail: 'Waiting for the local worker to generate a review draft.',
				tone: 'warn',
			};
		}
		return {
			status: 'ready',
			label: scheduledAt ? `Due ${formatDate(scheduledAt)}` : 'Ready',
			detail: 'This step is queued for local draft generation.',
			tone: 'neutral',
		};
	}

	if (step.status === 'pending' && scheduledAt) {
		return {
			status: 'scheduled',
			label: `Scheduled ${formatDate(scheduledAt)}`,
			detail: 'No draft will be generated until this step is due.',
			tone: 'neutral',
		};
	}

	if (step.status === 'sent') {
		return {
			status: 'done',
			label: 'Manual send confirmed',
			detail: step.sentAt ? `Confirmed ${formatDate(step.sentAt)}.` : 'Confirmed manually.',
			tone: 'ok',
		};
	}

	if (step.status === 'skipped') {
		return {
			status: 'done',
			label: 'Skipped',
			detail: 'This step was skipped without sending.',
			tone: 'neutral',
		};
	}

	return {
		status: 'idle',
		label: 'No due step',
		detail: 'No action is due for this step.',
		tone: 'neutral',
	};
}

const ATTENTION_PRIORITY: FollowUpPlanStepAttention['status'][] = [
	'needs_review',
	'blocked',
	'generating',
	'overdue',
	'ready',
	'scheduled',
	'done',
	'idle',
];

export function getFollowUpPlanAttentionSummary(
	steps: FollowUpPlanStepAttentionInput[],
	now: Date = new Date(),
) {
	const attentions = steps.map((step) => getFollowUpPlanStepAttention(step, now));
	return (
		ATTENTION_PRIORITY.map((status) =>
			attentions.find((attention) => attention.status === status),
		).find(Boolean) ?? getFollowUpPlanStepAttention({ status: 'idle' }, now)
	);
}

export function countBlockedFollowUpPlanSteps(steps: FollowUpPlanStepAttentionInput[]) {
	return steps.filter((step) => Boolean(step.lastProcessingError?.trim())).length;
}

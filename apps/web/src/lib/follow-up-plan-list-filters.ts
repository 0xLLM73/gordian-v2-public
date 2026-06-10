export const FOLLOW_UP_PLAN_LIST_STATUS_FILTERS = [
	'draft',
	'active',
	'paused',
	'completed',
	'cancelled',
] as const;

export const FOLLOW_UP_PLAN_ATTENTION_FILTERS = ['needs_review', 'overdue', 'active'] as const;

export type FollowUpPlanListStatusFilter = (typeof FOLLOW_UP_PLAN_LIST_STATUS_FILTERS)[number];
export type FollowUpPlanAttentionFilter = (typeof FOLLOW_UP_PLAN_ATTENTION_FILTERS)[number];

export interface FollowUpPlanListFilters {
	status?: FollowUpPlanListStatusFilter;
	attention?: FollowUpPlanAttentionFilter;
	templateId?: string;
}

interface FilterablePlan {
	status: string;
	templateId?: string | null;
}

interface FilterableStep {
	status: string;
	scheduledAt?: Date | string | null;
	draftText?: string | null;
}

function firstParam(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function parseEnumValue<T extends string>(value: string | undefined, allowed: readonly T[]) {
	return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function safeTemplateId(value: string | undefined) {
	const trimmed = value?.trim();
	if (!trimmed || trimmed.length > 100) return undefined;
	return trimmed;
}

export function parseFollowUpPlanListFilters(
	params: Record<string, string | string[] | undefined>,
): FollowUpPlanListFilters {
	return {
		status: parseEnumValue(firstParam(params.status), FOLLOW_UP_PLAN_LIST_STATUS_FILTERS),
		attention: parseEnumValue(firstParam(params.attention), FOLLOW_UP_PLAN_ATTENTION_FILTERS),
		templateId: safeTemplateId(firstParam(params.templateId)),
	};
}

export function hasFollowUpPlanListFilters(filters: FollowUpPlanListFilters) {
	return Boolean(filters.status || filters.attention || filters.templateId);
}

function stepIsOverdue(step: FilterableStep, now: Date) {
	if (step.status !== 'ready' || !step.scheduledAt) return false;
	const scheduledAt =
		step.scheduledAt instanceof Date ? step.scheduledAt : new Date(step.scheduledAt);
	return !Number.isNaN(scheduledAt.getTime()) && scheduledAt <= now;
}

export function followUpPlanMatchesFilters(
	plan: FilterablePlan,
	steps: FilterableStep[],
	filters: FollowUpPlanListFilters,
	now: Date,
) {
	if (filters.status && plan.status !== filters.status) return false;
	if (filters.templateId && plan.templateId !== filters.templateId) return false;

	if (filters.attention === 'needs_review') {
		return steps.some((step) => step.status === 'pending_review' && step.draftText);
	}
	if (filters.attention === 'overdue') {
		return steps.some((step) => stepIsOverdue(step, now));
	}
	if (filters.attention === 'active') {
		return plan.status === 'active';
	}

	return true;
}

export type FollowUpPlanReadinessTone = 'blocked' | 'ready' | 'unknown' | 'warning';

export interface FollowUpPlanReadinessItem {
	status: FollowUpPlanReadinessTone;
	label: string;
	value: string;
	detail: string;
}

export interface FollowUpPlanReadiness {
	localAi: FollowUpPlanReadinessItem;
	telegram: FollowUpPlanReadinessItem;
	notifications: FollowUpPlanReadinessItem;
}

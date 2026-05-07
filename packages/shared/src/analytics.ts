/**
 * Typed analytics event definitions for Gordian v2.
 *
 * Event naming: {category}.{action} — lowercase, dot-separated.
 * PII rules: NEVER include names, phone numbers, message content.
 * Allowed metadata: UUIDs, counts, durations, enum values, scores (0-1).
 */

// ─── Onboarding Funnel ──────────────────────────────────────────────

export type OnboardingStep =
	| 'connect'
	| 'verify'
	| 'sync'
	| 'what_matters'
	| 'calibrate'
	| 'first_look';

export interface OnboardingStepStarted {
	step: OnboardingStep;
}

export interface OnboardingStepCompleted {
	step: OnboardingStep;
	duration_ms: number;
}

export type OnboardingConsentGiven = Record<string, never>;

export type OnboardingPhoneSubmitted = Record<string, never>;

export interface OnboardingCodeSubmitted {
	requires_2fa: boolean;
}

export interface OnboardingVerificationSuccess {
	had_2fa: boolean;
}

export interface OnboardingVerificationError {
	error_type: string;
}

export type OnboardingSyncStarted = Record<string, never>;

export interface OnboardingSyncAdvanceClicked {
	contacts_at_advance: number;
	sync_complete: boolean;
}

export interface OnboardingCoffeeTestAnswered {
	sensitivity: 'everything' | 'specific' | 'tasks_only';
}

export interface OnboardingPriorityContactsSelected {
	count: number;
}

export interface OnboardingCalibrationSamplesLoaded {
	sample_count: number;
}

export interface OnboardingCalibrationSampleRated {
	arm_type: string;
	action: 'approve' | 'reject' | 'edit';
	reason?: string;
}

export interface OnboardingCalibrationSubmitted {
	reaction_count: number;
}

export type OnboardingCalibrationSkipped = Record<string, never>;

export type OnboardingFirstLookViewed = Record<string, never>;

export interface OnboardingStepAbandoned {
	step: OnboardingStep;
	time_on_step_ms: number;
}

export interface OnboardingCompleted {
	total_duration_ms?: number;
}

// ─── Commitment Pipeline ────────────────────────────────────────────

export interface CommitmentExtracted {
	count: number;
	variant: string;
	trace_id: string;
}

export interface CommitmentConfidenceRouted {
	confidence: number;
	route: 'active' | 'draft' | 'discard';
}

export interface CommitmentDedupResult {
	result: 'create' | 'merge' | 'dismiss';
}

export interface CommitmentStored {
	trace_id: string;
	confidence: number;
}

export interface CommitmentDismissed {
	commitment_id: string;
}

export interface CommitmentCardViewed {
	commitment_id: string;
	source: string;
}

export interface CommitmentCardIgnored {
	commitment_id: string;
	source: string;
}

export interface BanditVariantSelected {
	variant: string;
	feature_domain: string;
}

export interface BanditRewardRecorded {
	variant: string;
	reward: number;
}

// ─── Dashboard Sections ─────────────────────────────────────────────

export type ActNowAction = 'complete' | 'dismiss' | 'send' | 'snooze';
export type ActNowItemType = 'overdue' | 'pending_draft' | 'follow_up';

export interface DashboardActNowView {
	overdue_count: number;
	pending_draft_count: number;
	follow_up_count: number;
}

export interface DashboardActNowClick {
	action: ActNowAction;
	item_type: ActNowItemType;
	item_id: string;
}

export interface DashboardWatchExpand {
	item_type: 'stale_contact' | 'ghosting_alert';
	contact_id?: string;
}

export interface DashboardNewIntelView {
	new_contact_count: number;
	trending_topic_count: number;
	intro_count: number;
}

export interface DashboardGhostingAlertAction {
	action: 'remind' | 'dismiss';
	contact_id: string;
}

export type DashboardSection = 'act_now' | 'watch' | 'new_intel';

export interface DashboardSectionTime {
	section: DashboardSection;
	visible_ms: number;
}

// ─── Engagement ─────────────────────────────────────────────────────

export type DashboardVisited = Record<string, never>;

export type BriefOpened = Record<string, never>;

export interface BriefDismissed {
	read_duration_ms?: number;
}

export interface BriefFeedback {
	reaction: 'helpful' | 'not_helpful';
}

export interface KnowledgeSearched {
	query_length: number;
	result_count: number;
}

export interface KnowledgeViewed {
	item_type: string;
}

export interface GhostingAlertShown {
	contact_count: number;
}

export interface GhostingAlertActed {
	action: 'remind' | 'dismiss';
}

// ─── Technical Health ───────────────────────────────────────────────

export interface SyncStarted {
	is_full_sync: boolean;
}

export interface SyncCompleted {
	duration_ms: number;
	contacts_synced: number;
	messages_synced: number;
	dialogs_processed: number;
}

export interface SyncFailed {
	error_type: string;
	attempt: number;
}

export type AIPipelineStarted = Record<string, never>;

export interface AIPipelineCompleted {
	duration_ms: number;
	child_count: number;
}

export interface AIPipelineChildCompleted {
	queue: string;
	duration_ms: number;
}

export interface AIPipelineFailed {
	queue: string;
	error_type: string;
}

export interface QueueDepth {
	queue: string;
	waiting: number;
	active: number;
	delayed: number;
}

// ─── Event Map ──────────────────────────────────────────────────────

export interface AnalyticsEventMap {
	// Onboarding
	'onboarding.step_started': OnboardingStepStarted;
	'onboarding.step_completed': OnboardingStepCompleted;
	'onboarding.consent_given': OnboardingConsentGiven;
	'onboarding.phone_submitted': OnboardingPhoneSubmitted;
	'onboarding.code_submitted': OnboardingCodeSubmitted;
	'onboarding.verification_success': OnboardingVerificationSuccess;
	'onboarding.verification_error': OnboardingVerificationError;
	'onboarding.sync_started': OnboardingSyncStarted;
	'onboarding.sync_advance_clicked': OnboardingSyncAdvanceClicked;
	'onboarding.coffee_test_answered': OnboardingCoffeeTestAnswered;
	'onboarding.priority_contacts_selected': OnboardingPriorityContactsSelected;
	'onboarding.calibration_samples_loaded': OnboardingCalibrationSamplesLoaded;
	'onboarding.calibration_sample_rated': OnboardingCalibrationSampleRated;
	'onboarding.calibration_submitted': OnboardingCalibrationSubmitted;
	'onboarding.calibration_skipped': OnboardingCalibrationSkipped;
	'onboarding.first_look_viewed': OnboardingFirstLookViewed;
	'onboarding.step_abandoned': OnboardingStepAbandoned;
	'onboarding.completed': OnboardingCompleted;

	// Commitment pipeline
	'commitment.extracted': CommitmentExtracted;
	'commitment.confidence_routed': CommitmentConfidenceRouted;
	'commitment.dedup_result': CommitmentDedupResult;
	'commitment.stored': CommitmentStored;
	'commitment.dismissed': CommitmentDismissed;
	'commitment.card_viewed': CommitmentCardViewed;
	'commitment.card_ignored': CommitmentCardIgnored;
	'bandit.variant_selected': BanditVariantSelected;
	'bandit.reward_recorded': BanditRewardRecorded;

	// Dashboard sections
	'dashboard.act_now_view': DashboardActNowView;
	'dashboard.act_now_click': DashboardActNowClick;
	'dashboard.watch_expand': DashboardWatchExpand;
	'dashboard.new_intel_view': DashboardNewIntelView;
	'dashboard.ghosting_alert_action': DashboardGhostingAlertAction;
	'dashboard.section_time': DashboardSectionTime;

	// Engagement
	'dashboard.visited': DashboardVisited;
	'brief.opened': BriefOpened;
	'brief.dismissed': BriefDismissed;
	'brief.feedback': BriefFeedback;
	'knowledge.searched': KnowledgeSearched;
	'knowledge.viewed': KnowledgeViewed;
	'ghosting_alert.shown': GhostingAlertShown;
	'ghosting_alert.acted': GhostingAlertActed;

	// Technical health
	'sync.started': SyncStarted;
	'sync.completed': SyncCompleted;
	'sync.failed': SyncFailed;
	'ai_pipeline.started': AIPipelineStarted;
	'ai_pipeline.completed': AIPipelineCompleted;
	'ai_pipeline.child_completed': AIPipelineChildCompleted;
	'ai_pipeline.failed': AIPipelineFailed;
	'queue.depth': QueueDepth;
}

/** All typed analytics event names */
export type AnalyticsEventName = keyof AnalyticsEventMap;

/** Properties for a specific event */
export type AnalyticsEventProperties<T extends AnalyticsEventName> = AnalyticsEventMap[T];

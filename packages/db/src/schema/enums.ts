import { pgEnum } from 'drizzle-orm/pg-core';

export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'admin', 'member']);

export const commitmentTypeEnum = pgEnum('commitment_type', [
	'promise',
	'task',
	'meeting',
	'financial',
]);

export const commitmentStatusEnum = pgEnum('commitment_status', [
	'active',
	'completed',
	'dismissed',
	'draft',
]);

export const decisionTypeEnum = pgEnum('decision_type', [
	'message',
	'click',
	'view',
	'purchase',
	'commitment',
	'dismissal',
]);

export const edgeTypeEnum = pgEnum('edge_type', [
	'explicit_reply',
	'implicit_context',
	'temporal',
	'semantic',
]);

export const correctionSourceEnum = pgEnum('correction_source', [
	'user_edit',
	'expert_review',
	'implicit_signal',
]);

export const difficultyTierEnum = pgEnum('difficulty_tier', ['trivial', 'standard', 'edge_case']);

export const verificationStatusEnum = pgEnum('verification_status', [
	'pending',
	'verified',
	'rejected',
]);

export const dealStatusEnum = pgEnum('deal_status', ['open', 'negotiating', 'won', 'lost']);

export const dealStageEnum = pgEnum('deal_stage', [
	'discovery',
	'diligence',
	'negotiation',
	'committed',
	'won',
	'lost',
]);

export const dealTypeEnum = pgEnum('deal_type', [
	'investment',
	'advisory',
	'partnership',
	'token',
	'other',
]);

export const dealSourceEnum = pgEnum('deal_source', ['manual', 'detected']);

export const dealParticipantRoleEnum = pgEnum('deal_participant_role', [
	'lead',
	'co_investor',
	'advisor',
	'counterparty',
	'introducer',
	'other',
]);

export const dealArtifactTypeEnum = pgEnum('deal_artifact_type', [
	'term_sheet',
	'saft',
	'token_warrant',
	'cap_table',
	'contract',
	'presentation',
	'note',
	'other',
]);

export const chatTypeEnum = pgEnum('chat_type', ['private', 'group', 'supergroup', 'channel']);

export const contactRelationshipEnum = pgEnum('contact_relationship', [
	'friend',
	'colleague',
	'prospect',
	'client',
	'investor',
	'family',
	'mentor',
	'mentee',
	'partner',
	'vendor',
	'other',
]);

export const contactPriorityEnum = pgEnum('contact_priority', ['high', 'medium', 'low']);

export const contactStatusEnum = pgEnum('contact_status', [
	'active',
	'nurturing',
	'dormant',
	'new',
]);

export const summaryStatusEnum = pgEnum('summary_status', [
	'generating',
	'ready',
	'stale',
	'failed',
]);

export const digestFocusEnum = pgEnum('digest_focus', [
	'balanced',
	'commitments',
	'relationships',
	'deals',
	'network',
]);

export const digestStatusEnum = pgEnum('digest_status', ['generating', 'ready', 'failed']);

export const digestPeriodEnum = pgEnum('digest_period', [
	'today',
	'yesterday',
	'3d',
	'week',
	'custom',
]);

export const memoryCategoryEnum = pgEnum('memory_category', [
	'general',
	'preference',
	'commitment',
	'relationship',
	'financial',
	'technical',
	'emotional',
	'temporal',
	'location',
	'organization',
	'project',
	'event',
	'communication_style',
	'decision_pattern',
	'risk_tolerance',
	'goal',
	'constraint',
	'expertise',
	'interest',
	'conflict',
	'agreement',
	'status_update',
	'context',
]);

export const relationshipTypeEnum = pgEnum('relationship_type', [
	'professional',
	'personal',
	'investor',
	'advisor',
	'co_investor',
	'introduced_by',
	'founder',
	'colleague',
	'other',
]);

export const relationshipSourceEnum = pgEnum('relationship_source', [
	'ai_extracted',
	'user_created',
	'inferred',
]);

export const draftArmEnum = pgEnum('draft_arm', [
	'casual_nudge',
	'professional_value',
	'direct_ask',
	'soft_memory',
]);

export const introStatusEnum = pgEnum('intro_status', ['triage', 'active', 'archive']);

export const introContextEnum = pgEnum('intro_context', [
	'deal',
	'hiring',
	'knowledge',
	'social',
	'other',
]);

export const goalTypeEnum = pgEnum('goal_type', [
	'relationship',
	'business',
	'habit',
	'network',
	'strategic',
]);

export const goalStatusEnum = pgEnum('goal_status', [
	'active',
	'paused',
	'completed',
	'abandoned',
	'proposed',
	'dismissed',
]);

export const goalProgressSourceEnum = pgEnum('goal_progress_source', [
	'manual',
	'network',
	'relationship',
	'habit',
	'business',
]);

export const followUpPlanStatusEnum = pgEnum('cadence_status', [
	'draft',
	'active',
	'paused',
	'completed',
	'cancelled',
]);

export const followUpPlanStepStatusEnum = pgEnum('cadence_step_status', [
	'pending',
	'ready',
	'pending_review',
	'sent',
	'skipped',
	'failed',
]);

export const connectionStatusEnum = pgEnum('connection_status', [
	'detected',
	'confirmed',
	'dismissed',
]);

export const dominantToneEnum = pgEnum('dominant_tone', [
	'casual',
	'professional',
	'warm',
	'terse',
]);

export const goalActionStatusEnum = pgEnum('goal_action_status', [
	'pending',
	'in_progress',
	'completed',
	'skipped',
]);

export const goalActionTypeEnum = pgEnum('goal_action_type', [
	'contact_outreach',
	'information_gathering',
	'document_creation',
	'meeting_scheduling',
	'decision_making',
]);

export const goalDomainTagEnum = pgEnum('goal_domain_tag', [
	'financial',
	'networking',
	'legal',
	'technical',
	'operational',
	'other',
]);

export const goalEffortEnum = pgEnum('goal_effort', ['quick', 'medium', 'deep']);

export const diffTypeEnum = pgEnum('diff_type', [
	'hallucination',
	'missing_field',
	'format_error',
	'wrong_entity',
	'wrong_date',
	'wrong_type',
	'false_positive',
	'false_negative',
	'confidence_miscalibration',
	'other',
]);

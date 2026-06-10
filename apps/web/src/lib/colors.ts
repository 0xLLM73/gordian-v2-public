/**
 * Centralized color maps for badges, statuses, and labels.
 * Single source of truth — import from here instead of defining inline.
 */

// ─── Deal Stages ────────────────────────────────────────────────────────────

export const DEAL_STAGE_COLORS: Record<string, string> = {
	discovery: 'bg-blue-100 text-blue-700',
	diligence: 'bg-indigo-100 text-indigo-700',
	negotiation: 'bg-yellow-100 text-yellow-700',
	committed: 'bg-purple-100 text-purple-700',
	won: 'bg-green-100 text-green-700',
	lost: 'bg-red-100 text-red-700',
};

export const DEAL_STAGE_BG_COLORS: Record<string, string> = {
	discovery: 'bg-blue-500',
	diligence: 'bg-indigo-500',
	negotiation: 'bg-yellow-500',
	committed: 'bg-purple-500',
	won: 'bg-green-500',
	lost: 'bg-red-500',
};

export const DEAL_STAGE_BORDER_COLORS: Record<string, string> = {
	discovery: 'border-blue-400',
	diligence: 'border-indigo-400',
	negotiation: 'border-yellow-400',
	committed: 'border-purple-400',
	won: 'border-green-400',
	lost: 'border-red-400',
};

// ─── Contact Health ─────────────────────────────────────────────────────────

export const HEALTH_BADGE_COLORS: Record<string, string> = {
	thriving: 'bg-green-100 text-green-700',
	strong: 'bg-green-100 text-green-700',
	healthy: 'bg-blue-100 text-blue-700',
	steady_low_touch: 'bg-cyan-100 text-cyan-700',
	stable: 'bg-blue-100 text-blue-700',
	cooling: 'bg-yellow-100 text-yellow-700',
	learning: 'bg-gray-100 text-gray-600',
	weak: 'bg-yellow-100 text-yellow-700',
	at_risk: 'bg-red-100 text-red-700',
	dormant: 'bg-red-100 text-red-700',
};

export const HEALTH_HEX_COLORS: Record<string, string> = {
	thriving: '#16a34a',
	healthy: '#2563eb',
	steady_low_touch: '#0891b2',
	cooling: '#d97706',
	learning: '#6b7280',
	dormant: '#dc2626',
	unknown: '#6b7280',
};

// ─── Knowledge ──────────────────────────────────────────────────────────────

export const KNOWLEDGE_TYPE_COLORS: Record<string, string> = {
	topic: 'bg-blue-100 text-blue-700',
	project: 'bg-indigo-100 text-indigo-700',
	organization: 'bg-green-100 text-green-700',
	technology: 'bg-purple-100 text-purple-700',
	sector: 'bg-orange-100 text-orange-700',
	concept: 'bg-gray-100 text-gray-700',
};

export const KNOWLEDGE_LINK_TYPE_COLORS: Record<string, string> = {
	part_of: 'bg-gray-100 text-gray-600',
	related_to: 'bg-blue-100 text-blue-700',
	competes_with: 'bg-red-100 text-red-700',
	builds_on: 'bg-purple-100 text-purple-700',
	funds: 'bg-green-100 text-green-700',
	uses: 'bg-orange-100 text-orange-700',
};

// ─── Goals ──────────────────────────────────────────────────────────────────

export const GOAL_STATUS_COLORS: Record<string, string> = {
	active: 'bg-green-100 text-green-700',
	paused: 'bg-yellow-100 text-yellow-700',
	completed: 'bg-blue-100 text-blue-700',
	abandoned: 'bg-gray-100 text-gray-500',
};

export const GOAL_TYPE_COLORS: Record<string, string> = {
	relationship: 'bg-pink-100 text-pink-700',
	business: 'bg-purple-100 text-purple-700',
	habit: 'bg-green-100 text-green-700',
	network: 'bg-blue-100 text-blue-700',
	strategic: 'bg-indigo-100 text-indigo-700',
};

export const GOAL_PROGRESS_SOURCE_COLORS: Record<string, string> = {
	manual: 'bg-gray-100 text-gray-700',
	network: 'bg-blue-100 text-blue-700',
	relationship: 'bg-pink-100 text-pink-700',
	habit: 'bg-green-100 text-green-700',
	business: 'bg-purple-100 text-purple-700',
};

// ─── Goal Actions ──────────────────────────────────────────────────────────

export const GOAL_ACTION_TYPE_COLORS: Record<string, string> = {
	contact_outreach: 'bg-pink-100 text-pink-700',
	information_gathering: 'bg-cyan-100 text-cyan-700',
	document_creation: 'bg-amber-100 text-amber-700',
	meeting_scheduling: 'bg-indigo-100 text-indigo-700',
	decision_making: 'bg-violet-100 text-violet-700',
};

export const GOAL_DOMAIN_TAG_COLORS: Record<string, string> = {
	financial: 'bg-green-100 text-green-700',
	networking: 'bg-blue-100 text-blue-700',
	legal: 'bg-red-100 text-red-700',
	technical: 'bg-purple-100 text-purple-700',
	operational: 'bg-orange-100 text-orange-700',
	other: 'bg-gray-100 text-gray-500',
};

export const GOAL_EFFORT_COLORS: Record<string, string> = {
	quick: 'bg-emerald-100 text-emerald-700',
	medium: 'bg-yellow-100 text-yellow-700',
	deep: 'bg-red-100 text-red-700',
};

export const GOAL_ACTION_STATUS_COLORS: Record<string, string> = {
	pending: 'bg-yellow-100 text-yellow-700',
	in_progress: 'bg-blue-100 text-blue-700',
	completed: 'bg-green-100 text-green-700',
	skipped: 'bg-gray-100 text-gray-500',
};

// ─── Outcomes ───────────────────────────────────────────────────────────────

export const OUTCOME_TYPE_COLORS: Record<string, string> = {
	deal_closed: 'bg-green-100 text-green-700',
	commitment_fulfilled: 'bg-blue-100 text-blue-700',
	commitment_missed: 'bg-gray-100 text-gray-600',
	goal_completed: 'bg-purple-100 text-purple-700',
	intro_connected: 'bg-teal-100 text-teal-700',
};

type OutcomeType =
	| 'deal_closed'
	| 'commitment_fulfilled'
	| 'commitment_missed'
	| 'goal_completed'
	| 'intro_connected'
	| 'relationship_health';
type OutcomeResult = 'positive' | 'negative' | 'neutral';

export const OUTCOME_BADGE: Record<
	OutcomeType,
	Record<OutcomeResult, { label: string; className: string }>
> = {
	deal_closed: {
		positive: { label: 'Won', className: 'bg-green-100 text-green-700' },
		negative: { label: 'Lost', className: 'bg-red-100 text-red-700' },
		neutral: { label: 'Closed', className: 'bg-gray-100 text-gray-600' },
	},
	commitment_fulfilled: {
		positive: { label: 'Fulfilled', className: 'bg-blue-100 text-blue-700' },
		negative: { label: 'Fulfilled', className: 'bg-blue-100 text-blue-700' },
		neutral: { label: 'Fulfilled', className: 'bg-blue-100 text-blue-700' },
	},
	commitment_missed: {
		positive: { label: 'Missed', className: 'bg-gray-100 text-gray-500' },
		negative: { label: 'Missed', className: 'bg-gray-100 text-gray-500' },
		neutral: { label: 'Missed', className: 'bg-gray-100 text-gray-500' },
	},
	goal_completed: {
		positive: { label: 'Completed', className: 'bg-purple-100 text-purple-700' },
		negative: { label: 'Completed', className: 'bg-purple-100 text-purple-700' },
		neutral: { label: 'Completed', className: 'bg-purple-100 text-purple-700' },
	},
	intro_connected: {
		positive: { label: 'Connected', className: 'bg-teal-100 text-teal-700' },
		negative: { label: 'Connected', className: 'bg-teal-100 text-teal-700' },
		neutral: { label: 'Connected', className: 'bg-teal-100 text-teal-700' },
	},
	relationship_health: {
		positive: { label: 'Healthy', className: 'bg-green-100 text-green-700' },
		negative: { label: 'At Risk', className: 'bg-red-100 text-red-700' },
		neutral: { label: 'Stable', className: 'bg-gray-100 text-gray-600' },
	},
};

// ─── Trends ─────────────────────────────────────────────────────────────────

export const TREND_STYLES: Record<string, { label: string; className: string }> = {
	heating_up: { label: '↑ Heating Up', className: 'bg-green-100 text-green-700' },
	steady: { label: '→ Steady', className: 'bg-gray-100 text-gray-600' },
	cooling_down: { label: '↓ Cooling Down', className: 'bg-red-100 text-red-700' },
};

// ─── Introductions ──────────────────────────────────────────────────────────

export const INTRO_CONTEXT_COLORS: Record<string, string> = {
	deal: 'bg-purple-100 text-purple-700',
	hiring: 'bg-blue-100 text-blue-700',
	knowledge: 'bg-green-100 text-green-700',
	social: 'bg-yellow-100 text-yellow-700',
	other: 'bg-gray-100 text-gray-500',
};

export const INTRO_STATUS_COLORS: Record<string, string> = {
	triage: 'bg-yellow-100 text-yellow-700',
	active: 'bg-green-100 text-green-700',
	archive: 'bg-gray-100 text-gray-500',
};

// ─── Connections ────────────────────────────────────────────────────────────

export const CONNECTION_STATUS_COLORS: Record<string, string> = {
	detected: 'bg-cyan-100 text-cyan-700',
	confirmed: 'bg-green-100 text-green-700',
	dismissed: 'bg-gray-100 text-gray-500',
};

// ─── Follow-up Plans ────────────────────────────────────────────────────────

export const FOLLOW_UP_PLAN_STATUS_COLORS: Record<string, string> = {
	draft: 'bg-gray-100 text-gray-700',
	active: 'bg-green-100 text-green-700',
	paused: 'bg-yellow-100 text-yellow-700',
	completed: 'bg-blue-100 text-blue-700',
	cancelled: 'bg-red-100 text-red-700',
};

// ─── Commitments ────────────────────────────────────────────────────────────

export const COMMITMENT_STATUS_COLORS: Record<string, string> = {
	active: 'bg-green-100 text-green-700',
	completed: 'bg-blue-100 text-blue-700',
	draft: 'bg-yellow-100 text-yellow-700',
	dismissed: 'bg-gray-100 text-gray-500',
	snoozed: 'bg-amber-100 text-amber-700',
};

// ─── Decision Actions ────────────────────────────────────────────────────────

export const DECISION_ACTION_COLORS: Record<string, string> = {
	deal_created: 'bg-blue-100 text-blue-700',
	deal_advanced: 'bg-indigo-100 text-indigo-700',
	deal_won: 'bg-green-100 text-green-700',
	deal_lost: 'bg-red-100 text-red-700',
	intro_created: 'bg-teal-100 text-teal-700',
	commitment_created: 'bg-purple-100 text-purple-700',
	goal_created: 'bg-cyan-100 text-cyan-700',
};

// ─── Recommendations ────────────────────────────────────────────────────────

export const RECOMMENDATION_TYPE_COLORS: Record<string, string> = {
	re_engage: 'bg-amber-100 text-amber-700',
	follow_up: 'bg-blue-100 text-blue-700',
	advance_deal: 'bg-purple-100 text-purple-700',
	make_intro: 'bg-green-100 text-green-700',
	achieve_goal: 'bg-indigo-100 text-indigo-700',
};

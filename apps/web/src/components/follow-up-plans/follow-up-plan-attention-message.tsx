import type { FollowUpPlanStepAttention } from '@/lib/follow-up-plan-step-attention';

const EXPLAINED_ATTENTION_STATUSES = new Set(['blocked', 'generating', 'overdue']);

function toneClass(tone: FollowUpPlanStepAttention['tone']) {
	if (tone === 'danger') return 'text-red-700';
	if (tone === 'warn') return 'text-amber-700';
	return 'text-muted-foreground';
}

export function FollowUpPlanAttentionMessage({
	attention,
}: {
	attention: FollowUpPlanStepAttention;
}) {
	if (!EXPLAINED_ATTENTION_STATUSES.has(attention.status)) return null;

	return (
		<p className={`mt-1 text-sm ${toneClass(attention.tone)}`}>
			{attention.label}: {attention.detail} Draft not sent.
		</p>
	);
}

import { DECISION_ACTION_COLORS } from '@/lib/colors';
import { formatRelativeDate } from '@/lib/format';

export interface DealDecisionTrailDecision {
	id: string;
	decisionType?: string | null;
	sourceType?: string | null;
	status?: string | null;
	label: string;
	rationale?: string | null;
	decidedAt?: Date | string | null;
	evidence?: Array<{ id: string; label?: string | null; sourceType?: string | null }>;
}

export interface DealKnowledgeDecision {
	id: string;
	displayName: string;
	action: string | null;
	decidedAt: string | null;
	rationales: string[];
	outcomes: Array<{ displayName: string; result: string | null }>;
}

export function DealDecisionTrailPanel({
	decisions,
	knowledgeTrail = [],
}: {
	decisions: DealDecisionTrailDecision[];
	knowledgeTrail?: DealKnowledgeDecision[];
}) {
	return (
		<section
			data-testid="deal-decision-trail"
			className="rounded-lg border border-border bg-card p-4"
		>
			<div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<h2 className="text-sm font-semibold text-foreground">Decision Trail</h2>
				<span className="text-xs text-muted-foreground">
					{decisions.length + knowledgeTrail.length} entr
					{decisions.length + knowledgeTrail.length === 1 ? 'y' : 'ies'}
				</span>
			</div>
			{decisions.length === 0 && knowledgeTrail.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No decisions recorded yet. Stage changes and accepted recommendations will appear here.
				</p>
			) : (
				<div className="space-y-3">
					{decisions.map((decision) => (
						<DecisionCard key={decision.id} decision={decision} />
					))}
					{knowledgeTrail.map((step) => (
						<KnowledgeDecisionCard key={step.id} step={step} />
					))}
				</div>
			)}
		</section>
	);
}

function DecisionCard({ decision }: { decision: DealDecisionTrailDecision }) {
	const decidedAt = decision.decidedAt ? new Date(decision.decidedAt) : null;
	const actionLabel = decision.decisionType?.replace(/_/g, ' ') || 'Decision';
	return (
		<div className="rounded-md bg-muted px-3 py-2">
			<div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span
							className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${DECISION_ACTION_COLORS[decision.decisionType ?? ''] || 'bg-gray-100 text-gray-600'}`}
						>
							{actionLabel}
						</span>
						<span className="break-words text-sm font-medium text-foreground">
							{decision.label}
						</span>
					</div>
					{decision.rationale ? (
						<p className="mt-1 text-sm text-muted-foreground">{decision.rationale}</p>
					) : null}
					{decision.evidence && decision.evidence.length > 0 ? (
						<p className="mt-1 text-xs text-muted-foreground">
							{decision.evidence.length} linked evidence source
							{decision.evidence.length === 1 ? '' : 's'}
						</p>
					) : null}
				</div>
				{decidedAt ? (
					<time className="shrink-0 text-xs text-muted-foreground">
						{formatRelativeDate(decidedAt)}
					</time>
				) : null}
			</div>
		</div>
	);
}

function KnowledgeDecisionCard({ step }: { step: DealKnowledgeDecision }) {
	const actionLabel = step.action ? step.action.replace(/_/g, ' ') : 'Decision';
	return (
		<div className="rounded-md border border-border px-3 py-2">
			<div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span
							className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${DECISION_ACTION_COLORS[step.action ?? ''] || 'bg-gray-100 text-gray-600'}`}
						>
							{actionLabel}
						</span>
						<span className="break-words text-sm font-medium text-foreground">
							{step.displayName}
						</span>
					</div>
					{step.rationales.length > 0 ? (
						<p className="mt-1 text-xs text-muted-foreground">
							Rationales: {step.rationales.join(', ')}
						</p>
					) : null}
				</div>
				{step.decidedAt ? (
					<time className="shrink-0 text-xs text-muted-foreground">
						{formatRelativeDate(new Date(step.decidedAt))}
					</time>
				) : null}
			</div>
		</div>
	);
}

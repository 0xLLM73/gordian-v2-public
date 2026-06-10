import { formatCurrency } from '@/lib/format';

const stageLabels: Record<string, string> = {
	discovery: 'Discovery',
	diligence: 'Diligence',
	negotiation: 'Negotiation',
	committed: 'Committed',
	won: 'Won',
	lost: 'Lost',
};

export function DealOverviewPanel({
	stage,
	value,
	participantCount,
	artifactCount,
	evidenceCount,
	hasTerminalOutcomeReason,
}: {
	stage: string;
	value: number;
	participantCount: number;
	artifactCount: number;
	evidenceCount: number;
	hasTerminalOutcomeReason: boolean;
}) {
	const nextActions: string[] = [];
	if (participantCount === 0) nextActions.push('Add at least one participant');
	if (artifactCount === 0) nextActions.push('Attach supporting artifacts');
	if ((stage === 'won' || stage === 'lost') && !hasTerminalOutcomeReason) {
		nextActions.push('Record the outcome reason');
	}
	if (evidenceCount === 0) nextActions.push('Link source evidence');
	if (nextActions.length === 0)
		nextActions.push('Review current stage and evidence before the next move');

	return (
		<section
			data-testid="deal-overview-panel"
			className="mb-6 rounded-lg border border-border bg-card p-4"
		>
			<div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<h2 className="text-sm font-semibold text-foreground">Overview</h2>
				<span className="text-xs text-muted-foreground">Deterministic cockpit status</span>
			</div>
			<div className="grid gap-3 sm:grid-cols-4">
				<OverviewMetric label="Stage" value={stageLabels[stage] || stage} />
				<OverviewMetric label="Value" value={formatCurrency(value)} />
				<OverviewMetric label="Participants" value={String(participantCount)} />
				<OverviewMetric label="Artifacts" value={String(artifactCount)} />
			</div>
			<div className="mt-4 rounded-md bg-muted px-3 py-2">
				<p className="text-xs font-medium uppercase text-muted-foreground">Next actions</p>
				<ul className="mt-1 space-y-1">
					{nextActions.map((action) => (
						<li key={action} className="text-sm text-foreground">
							{action}
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md bg-muted px-3 py-2">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</p>
		</div>
	);
}

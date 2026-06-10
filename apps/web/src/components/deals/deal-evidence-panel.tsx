export interface DealEvidencePanelLink {
	id: string;
	sourceType: string;
	sourceId?: string | null;
	label?: string | null;
	summary?: string | null;
}

export function DealEvidencePanel({ evidence }: { evidence: DealEvidencePanelLink[] }) {
	return (
		<section
			data-testid="deal-evidence-panel"
			className="rounded-lg border border-border bg-card p-4"
		>
			<div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<h2 className="text-sm font-semibold text-foreground">Source Evidence</h2>
				<span className="text-xs text-muted-foreground">
					{evidence.length} linked source{evidence.length === 1 ? '' : 's'}
				</span>
			</div>
			{evidence.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No source evidence linked yet. Link artifacts, messages, knowledge evidence, or manual
					notes before relying on inferred context.
				</p>
			) : (
				<div className="space-y-2">
					{evidence.map((item) => (
						<div key={item.id} className="rounded-md bg-muted px-3 py-2">
							<div className="flex flex-wrap items-center gap-2">
								<span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
									{item.sourceType.replace(/_/g, ' ')}
								</span>
								<span className="break-words text-sm font-medium text-foreground">
									{item.label || 'Linked evidence'}
								</span>
							</div>
							{item.summary ? (
								<p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
							) : null}
						</div>
					))}
				</div>
			)}
		</section>
	);
}

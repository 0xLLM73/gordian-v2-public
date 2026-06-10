export function DealLocalAiStatus() {
	return (
		<section
			data-testid="deal-local-ai-status"
			className="rounded-lg border border-border bg-card p-4"
		>
			<div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<h2 className="text-sm font-semibold text-foreground">Local AI</h2>
				<span className="text-xs text-muted-foreground">Optional</span>
			</div>
			<p className="text-sm text-muted-foreground">
				Local AI assistance is not required for this cockpit. Source-backed briefs and drafts will
				appear here when the local model path is configured.
			</p>
		</section>
	);
}

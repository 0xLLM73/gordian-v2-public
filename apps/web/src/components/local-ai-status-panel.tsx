import {
	getChatLlmRuntime,
	getCommitmentLlmRuntime,
	getDigestLlmRuntime,
	getKnowledgeEmbeddingFingerprintWarning,
	getKnowledgeEmbeddingRuntime,
	getKnowledgeLlmRuntime,
} from '@repo/shared';

interface ModelStatusItem {
	detail: string;
	label: string;
	mode: string;
	model: string;
	status: 'cloud' | 'disabled' | 'local';
}

interface LocalAiStatus {
	items: ModelStatusItem[];
	postureSummary: string;
	postureTone: 'ok' | 'warn' | 'neutral';
	warning?: string;
}

function statusClass(status: ModelStatusItem['status']) {
	if (status === 'local') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
	if (status === 'disabled') return 'border-slate-200 bg-slate-50 text-slate-700';
	return 'border-amber-200 bg-amber-50 text-amber-800';
}

function postureClass(tone: LocalAiStatus['postureTone']) {
	if (tone === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
	if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-900';
	return 'border-slate-200 bg-slate-50 text-slate-800';
}

function summarizePosture(
	items: ModelStatusItem[],
	warning?: string,
): Pick<LocalAiStatus, 'postureSummary' | 'postureTone'> {
	if (warning && items.length === 0) {
		return {
			postureSummary: 'AI runtime configuration needs attention before model status is reliable.',
			postureTone: 'warn',
		};
	}

	const cloudLabels = items.filter((item) => item.status === 'cloud').map((item) => item.label);
	if (cloudLabels.length > 0) {
		return {
			postureSummary: `Cloud AI is configured for ${cloudLabels.join(', ')}.`,
			postureTone: 'warn',
		};
	}

	const localLabels = items.filter((item) => item.status === 'local').map((item) => item.label);
	if (localLabels.length > 0) {
		return {
			postureSummary: `Local AI is configured for ${localLabels.join(', ')}; other roles are off.`,
			postureTone: 'ok',
		};
	}

	return {
		postureSummary: 'AI model features are disabled for this deployment.',
		postureTone: 'neutral',
	};
}

function safeItems(): LocalAiStatus {
	try {
		const embedding = getKnowledgeEmbeddingRuntime(process.env);
		const knowledge = getKnowledgeLlmRuntime(process.env);
		const commitment = getCommitmentLlmRuntime(process.env);
		const chat = getChatLlmRuntime(process.env);
		const digest = getDigestLlmRuntime(process.env);
		const fingerprintWarning = getKnowledgeEmbeddingFingerprintWarning(process.env);
		const items: ModelStatusItem[] = [
			{
				label: 'AI search vectors',
				status: embedding.mode,
				mode: embedding.label,
				model: embedding.model,
				detail: `${embedding.dimensions} dimensions`,
			},
			{
				label: 'Knowledge extraction',
				status: knowledge.mode,
				mode: knowledge.label,
				model: knowledge.model ?? 'not configured',
				detail:
					knowledge.mode === 'disabled'
						? 'Extraction disabled'
						: knowledge.mode === 'local'
							? 'Local JSON extraction'
							: 'Cloud JSON extraction',
			},
			{
				label: 'Commitment extraction',
				status: commitment.mode,
				mode: commitment.label,
				model: commitment.model ?? 'cloud default',
				detail:
					commitment.mode === 'disabled'
						? 'Extraction disabled'
						: commitment.mode === 'local'
							? 'Using COMMITMENT_LLM_*'
							: 'Using cloud fallback',
			},
			{
				label: 'Digest generation',
				status: digest.mode,
				mode: digest.label,
				model: digest.model ?? 'cloud default',
				detail:
					digest.source === 'digest'
						? 'Using DIGEST_LLM_*'
						: digest.source === 'chat-fallback'
							? 'Using CHAT_LLM_* fallback'
							: digest.source === 'commitment-fallback'
								? 'Using COMMITMENT_LLM_* fallback'
								: 'Using cloud fallback',
			},
			{
				label: 'Chat assistant',
				status: chat.mode,
				mode: chat.label,
				model: chat.model ?? 'cloud default',
				detail:
					chat.source === 'commitment-fallback'
						? 'Using COMMITMENT_LLM_* fallback'
						: chat.source === 'chat'
							? 'Using CHAT_LLM_*'
							: 'Using cloud fallback',
			},
		];
		const posture = summarizePosture(items, fingerprintWarning);

		return {
			...posture,
			warning: fingerprintWarning,
			items,
		};
	} catch (err) {
		const warning = err instanceof Error ? err.message : 'Local AI status could not be read.';
		const posture = summarizePosture([], warning);
		return {
			...posture,
			warning,
			items: [],
		};
	}
}

export function LocalAiStatusPanel() {
	const { items, postureSummary, postureTone, warning } = safeItems();

	return (
		<section className="mb-6 rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-foreground">Local model status</h2>
					<p className="text-xs text-muted-foreground">
						Configured models for search, knowledge extraction, digest, and chat.
					</p>
				</div>
			</div>

			{warning ? (
				<div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
					{warning}
				</div>
			) : null}

			<div className={`mb-3 rounded-md border px-3 py-2 text-xs ${postureClass(postureTone)}`}>
				<span className="font-medium">Privacy posture:</span> {postureSummary}
			</div>

			<div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
				<span className="font-medium">Runtime readiness:</span> This panel shows configured model
				roles. Live analysis still requires Ollama to be reachable, the listed models to be
				installed, 512-dimensional embeddings to pass smoke, and KG JSON extraction to return valid
				structured output.
			</div>

			<div className="grid gap-3 md:grid-cols-5">
				{items.map((item) => (
					<div key={item.label} className="rounded-md border border-border bg-background p-3">
						<div className="mb-2 flex items-center justify-between gap-2">
							<p className="text-xs font-medium text-muted-foreground">{item.label}</p>
							<span
								className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(item.status)}`}
							>
								{item.status}
							</span>
						</div>
						<p className="text-sm font-medium text-foreground">{item.model}</p>
						<p className="mt-1 text-xs text-muted-foreground">{item.mode}</p>
						<p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
					</div>
				))}
			</div>
		</section>
	);
}

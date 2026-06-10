import { isVendorAiEgressEnabled } from './ai-privacy';
import { type ChatLlmRuntime, getChatLlmRuntime } from './chat-ai';
import { type EnvLike, getKnowledgeEmbeddingRuntime, getKnowledgeLlmRuntime } from './knowledge-ai';

export type DealLocalAiRunType =
	| 'brief'
	| 'risk'
	| 'next_action'
	| 'follow_up_draft'
	| 'question_answer'
	| 'commitment_suggestion'
	| 'stage_update_suggestion';

export interface DealContextSource {
	id: string;
	type: string;
	label: string;
	snippet: string;
	timestamp?: string;
}

export interface DealContextPack {
	workspaceId: string;
	dealId: string;
	title: string;
	stage: string;
	value: number;
	contactId?: string | null;
	notes?: string | null;
	sourceManifest: DealContextSource[];
	metrics: {
		participants: number;
		artifacts: number;
		evidence: number;
		stageEvents: number;
	};
	risks: string[];
	nextActions: string[];
}

export interface DealLocalAiStatus {
	chatConfigured: boolean;
	chatLabel: string;
	chatModel: string;
	chatSource: string;
	embeddingLabel: string;
	embeddingModel: string;
	knowledgeLabel: string;
	knowledgeModel: string;
	localOnly: boolean;
	liveModelEnabled: boolean;
	vendorEgressEnabled: boolean;
	warning?: string;
}

export interface DealLocalAiGeneratedOutput {
	runType: DealLocalAiRunType;
	output: string;
	uncertainty: string;
	modelRole: string;
	modelName: string;
	localVendorMode: 'local' | 'disabled' | 'deterministic_fallback';
	sourceManifest: Array<Record<string, unknown>>;
	usedModel: boolean;
}

export interface BuildDealContextInput {
	workspaceId: string;
	deal: Record<string, unknown>;
	participants?: Array<Record<string, unknown>>;
	artifacts?: Array<Record<string, unknown>>;
	stageEvents?: Array<Record<string, unknown>>;
	evidenceLinks?: Array<Record<string, unknown>>;
}

function text(value: unknown, fallback = ''): string {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalDate(value: unknown): string | undefined {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string' && value.trim()) return value;
	return undefined;
}

function assertScopedRow(
	workspaceId: string,
	dealId: string,
	row: Record<string, unknown>,
	label: string,
) {
	if (typeof row.workspaceId === 'string' && row.workspaceId !== workspaceId) {
		throw new Error(`${label} belongs to another workspace`);
	}
	if (typeof row.dealId === 'string' && row.dealId !== dealId) {
		throw new Error(`${label} belongs to another deal`);
	}
}

function source(
	type: string,
	id: unknown,
	label: string,
	snippet: string,
	timestamp?: unknown,
): DealContextSource {
	return {
		type,
		id: text(id, `${type}:manual`),
		label,
		snippet,
		timestamp: optionalDate(timestamp),
	};
}

function dollars(cents: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0,
	}).format(cents / 100);
}

export function getDealLocalAiStatus(env: EnvLike = process.env): DealLocalAiStatus {
	try {
		const chat = getChatLlmRuntime(env);
		const embedding = getKnowledgeEmbeddingRuntime(env);
		const knowledge = getKnowledgeLlmRuntime(env);
		const vendorEgressEnabled = isVendorAiEgressEnabled(env);
		const liveModelEnabled = env.DEAL_LOCAL_AI_LIVE_MODEL_ENABLED === 'true';
		return {
			chatConfigured: chat.mode === 'local',
			chatLabel: chat.label,
			chatModel: chat.model ?? 'not configured',
			chatSource: chat.source,
			embeddingLabel: embedding.label,
			embeddingModel: embedding.model,
			knowledgeLabel: knowledge.label,
			knowledgeModel: knowledge.model ?? 'not configured',
			localOnly: chat.mode === 'local' && !vendorEgressEnabled,
			liveModelEnabled,
			vendorEgressEnabled,
		};
	} catch (err) {
		return {
			chatConfigured: false,
			chatLabel: 'Local chat unavailable',
			chatModel: 'not configured',
			chatSource: 'default',
			embeddingLabel: 'Unknown embedding runtime',
			embeddingModel: 'not configured',
			knowledgeLabel: 'Unknown knowledge runtime',
			knowledgeModel: 'not configured',
			localOnly: false,
			liveModelEnabled: env.DEAL_LOCAL_AI_LIVE_MODEL_ENABLED === 'true',
			vendorEgressEnabled: isVendorAiEgressEnabled(env),
			warning: err instanceof Error ? err.message : 'Local AI status could not be read.',
		};
	}
}

export function buildDealContextPack(input: BuildDealContextInput): DealContextPack {
	const dealId = text(input.deal.id);
	if (!dealId) throw new Error('Deal context requires a deal id');
	assertScopedRow(input.workspaceId, dealId, input.deal, 'Deal');

	const title = text(input.deal.title, 'Untitled deal');
	const stage = text(input.deal.stage, 'unknown');
	const value = numberValue(input.deal.value);
	const manifest: DealContextSource[] = [
		source(
			'deal',
			dealId,
			title,
			`Deal is in ${stage} with value ${dollars(value)}.`,
			input.deal.updatedAt,
		),
	];

	for (const participant of input.participants ?? []) {
		assertScopedRow(input.workspaceId, dealId, participant, 'Participant');
		const role = text(participant.role, 'participant');
		const contactId = text(participant.contactId, 'contact');
		manifest.push(
			source(
				'deal_participant',
				participant.id,
				`Participant ${contactId}`,
				`Role: ${role}.`,
				participant.updatedAt ?? participant.createdAt,
			),
		);
	}

	for (const artifact of input.artifacts ?? []) {
		assertScopedRow(input.workspaceId, dealId, artifact, 'Artifact');
		manifest.push(
			source(
				'deal_artifact',
				artifact.id,
				text(artifact.title, 'Deal artifact'),
				`Artifact type: ${text(artifact.artifactType, 'other')}.`,
				artifact.updatedAt ?? artifact.createdAt,
			),
		);
	}

	for (const event of input.stageEvents ?? []) {
		assertScopedRow(input.workspaceId, dealId, event, 'Stage event');
		const previous = text(event.previousStage, 'start');
		const next = text(event.nextStage, 'unknown');
		const note = text(event.note);
		manifest.push(
			source(
				'deal_stage_event',
				event.id,
				`${previous} -> ${next}`,
				note ? `Stage note: ${note}` : `Stage moved from ${previous} to ${next}.`,
				event.occurredAt ?? event.createdAt,
			),
		);
	}

	for (const evidence of input.evidenceLinks ?? []) {
		assertScopedRow(input.workspaceId, dealId, evidence, 'Evidence');
		manifest.push(
			source(
				text(evidence.sourceType, 'manual_note'),
				evidence.sourceId ?? evidence.id,
				text(evidence.label, 'Source evidence'),
				text(evidence.summary, 'Linked evidence is present but has no summary.'),
				evidence.createdAt,
			),
		);
	}

	const metrics = {
		participants: input.participants?.length ?? 0,
		artifacts: input.artifacts?.length ?? 0,
		evidence: input.evidenceLinks?.length ?? 0,
		stageEvents: input.stageEvents?.length ?? 0,
	};
	const risks = deriveDealRisks({ stage, value, metrics });
	const nextActions = deriveNextActions({ stage, metrics });

	return {
		workspaceId: input.workspaceId,
		dealId,
		title,
		stage,
		value,
		contactId: text(input.deal.contactId) || null,
		notes: text(input.deal.notes) || null,
		sourceManifest: manifest,
		metrics,
		risks,
		nextActions,
	};
}

function deriveDealRisks(input: {
	stage: string;
	value: number;
	metrics: DealContextPack['metrics'];
}): string[] {
	const risks: string[] = [];
	if (input.metrics.evidence === 0) risks.push('No source evidence is linked to this deal yet.');
	if (input.metrics.participants === 0) risks.push('No participant role is recorded.');
	if (input.metrics.artifacts === 0) risks.push('No encrypted deal artifact is attached.');
	if (input.metrics.stageEvents === 0) risks.push('No durable stage event has been recorded.');
	if (input.value >= 1_000_000_00) risks.push('High-value deal needs explicit evidence review.');
	if ((input.stage === 'won' || input.stage === 'lost') && input.metrics.evidence === 0) {
		risks.push('Terminal outcome lacks linked rationale evidence.');
	}
	return risks.length > 0 ? risks : ['No deterministic risk flags are currently active.'];
}

function deriveNextActions(input: {
	stage: string;
	metrics: DealContextPack['metrics'];
}): string[] {
	const actions: string[] = [];
	if (input.metrics.evidence === 0)
		actions.push('Link source evidence before relying on AI wording.');
	if (input.metrics.artifacts === 0)
		actions.push('Attach the current term sheet, SAFT, deck, or note.');
	if (input.metrics.participants === 0)
		actions.push('Add the primary counterparty or lead contact.');
	if (input.stage === 'discovery') actions.push('Capture the next diligence question.');
	if (input.stage === 'diligence')
		actions.push('Draft a follow-up that asks for the missing evidence.');
	if (input.stage === 'negotiation') actions.push('Record the open terms and decision owner.');
	return actions.length > 0
		? actions
		: ['Review the latest evidence and decide whether to advance stage.'];
}

function uncertaintyFor(context: DealContextPack): string {
	if (context.metrics.evidence === 0) {
		return 'High uncertainty: no linked source evidence is attached to this deal.';
	}
	if (context.sourceManifest.length < 3) {
		return 'Medium uncertainty: limited local deal sources are available.';
	}
	return 'Low uncertainty for source-backed deal metadata; still verify before acting.';
}

export function buildDeterministicDealOutput(
	context: DealContextPack,
	runType: DealLocalAiRunType,
	question?: string,
): DealLocalAiGeneratedOutput {
	const sourceCount = context.sourceManifest.length;
	const uncertainty = uncertaintyFor(context);
	const risks = context.risks.map((risk) => `- ${risk}`).join('\n');
	const actions = context.nextActions.map((action) => `- ${action}`).join('\n');
	const answerableQuestion =
		question && context.metrics.evidence > 0
			? `Question: ${question}\nAnswer: I can only answer from the ${sourceCount} linked local sources. The strongest supported point is that ${context.title} is in ${context.stage} with ${context.metrics.evidence} linked evidence item(s).`
			: question
				? `Question: ${question}\nAnswer: I do not have enough linked source evidence to answer that safely. Add evidence or ask about visible deal metadata.`
				: '';

	const bodyByType: Record<DealLocalAiRunType, string> = {
		brief: `${context.title} is currently in ${context.stage} with ${dollars(context.value)} tracked value. The cockpit has ${context.metrics.participants} participant(s), ${context.metrics.artifacts} encrypted artifact(s), ${context.metrics.evidence} linked evidence item(s), and ${context.metrics.stageEvents} durable stage event(s).\n\nRisks:\n${risks}\n\nNext actions:\n${actions}`,
		risk: `Deterministic risk explanation for ${context.title}:\n${risks}`,
		next_action: `Recommended next actions for ${context.title}:\n${actions}`,
		follow_up_draft: `Draft only - not sent: Hi, following up on ${context.title}. Could you send the missing materials or confirm the next diligence step so I can keep the deal record source-backed?`,
		question_answer: answerableQuestion,
		commitment_suggestion: `Draft commitment suggestion - requires explicit acceptance: Review ${context.title} evidence and decide whether the next stage is supported.`,
		stage_update_suggestion: `Draft stage suggestion - requires explicit acceptance: Keep ${context.title} in ${context.stage} until source evidence supports a change.`,
	};

	return {
		runType,
		output: bodyByType[runType],
		uncertainty,
		modelRole: 'deterministic_fallback',
		modelName: 'local-context-rules',
		localVendorMode: 'deterministic_fallback',
		sourceManifest: context.sourceManifest.map((item) => ({ ...item })),
		usedModel: false,
	};
}

function stripJsonFence(textValue: string): string {
	return textValue
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

function parseLocalModelOutput(
	textValue: string,
	fallback: DealLocalAiGeneratedOutput,
): DealLocalAiGeneratedOutput {
	const stripped = stripJsonFence(textValue);
	const firstBrace = stripped.indexOf('{');
	const lastBrace = stripped.lastIndexOf('}');
	if (firstBrace < 0 || lastBrace <= firstBrace) return fallback;
	const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
	return {
		...fallback,
		output: text(parsed.output, fallback.output),
		uncertainty: text(parsed.uncertainty, fallback.uncertainty),
		usedModel: true,
		localVendorMode: 'local',
	};
}

function responseFormat(): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			output: { type: 'string' },
			uncertainty: { type: 'string' },
		},
		required: ['output', 'uncertainty'],
	};
}

function localPrompt(context: DealContextPack, runType: DealLocalAiRunType, question?: string) {
	return `You are generating local-only deal intelligence for Gordian.
Return only JSON: {"output":"...","uncertainty":"..."}.
Rules:
- Use only the provided source manifest and deterministic metrics.
- Do not claim to send messages, mutate Telegram, change deal stages, or create commitments.
- Any commitment or stage update must be worded as a draft suggestion requiring explicit user acceptance.
- If evidence is missing, say uncertainty is high and refuse unsupported claims.

Run type: ${runType}
Question: ${question || 'none'}
Deal context:
${JSON.stringify(context, null, 2)}`;
}

async function callLocalModel(
	runtime: ChatLlmRuntime,
	prompt: string,
	timeoutMs: number,
): Promise<string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response =
			runtime.api === 'ollama'
				? await fetch(runtime.ollamaChatUrl ?? '', {
						method: 'POST',
						headers,
						signal: controller.signal,
						body: JSON.stringify({
							model: runtime.model,
							messages: [
								{ role: 'system', content: 'Return only JSON. No tool use.' },
								{ role: 'user', content: prompt },
							],
							stream: false,
							think: false,
							format: responseFormat(),
							options: { temperature: 0.2, num_predict: 1024 },
						}),
					})
				: await fetch(runtime.chatCompletionsUrl ?? '', {
						method: 'POST',
						headers,
						signal: controller.signal,
						body: JSON.stringify({
							model: runtime.model,
							messages: [
								{ role: 'system', content: 'Return only JSON. No tool use.' },
								{ role: 'user', content: prompt },
							],
							temperature: 0.2,
							max_tokens: 1024,
							response_format: { type: 'json_object' },
						}),
					});

		if (!response.ok) throw new Error(`Local deal AI error (${response.status})`);
		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string | null } }>;
			message?: { content?: string | null };
		};
		const content =
			runtime.api === 'ollama'
				? data.message?.content?.trim()
				: data.choices?.[0]?.message?.content?.trim();
		if (!content) throw new Error('Local deal AI returned no content');
		return content;
	} finally {
		clearTimeout(timeout);
	}
}

function timeoutFromEnv(env: EnvLike): number {
	const raw = env.DEAL_LOCAL_AI_TIMEOUT_MS?.trim();
	const parsed = raw ? Number(raw) : 3000;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

export async function generateDealLocalAiOutput(
	context: DealContextPack,
	runType: DealLocalAiRunType,
	options?: {
		env?: EnvLike;
		question?: string;
		allowLiveModel?: boolean;
	},
): Promise<DealLocalAiGeneratedOutput> {
	const env = options?.env ?? process.env;
	const fallback = buildDeterministicDealOutput(context, runType, options?.question);
	if (options?.allowLiveModel === false) return fallback;

	let runtime: ChatLlmRuntime;
	try {
		runtime = getChatLlmRuntime(env);
	} catch (err) {
		return {
			...fallback,
			uncertainty: `${fallback.uncertainty} Local model configuration warning: ${
				err instanceof Error ? err.message : 'unknown error'
			}`,
		};
	}

	if (runtime.mode !== 'local' || !runtime.model) return fallback;

	try {
		const content = await callLocalModel(
			runtime,
			localPrompt(context, runType, options?.question),
			timeoutFromEnv(env),
		);
		return {
			...parseLocalModelOutput(content, fallback),
			modelRole: 'local_chat',
			modelName: runtime.model,
			localVendorMode: 'local',
		};
	} catch (_err) {
		return {
			...fallback,
			uncertainty: `${fallback.uncertainty} Local model was unavailable, so deterministic fallback was used.`,
			modelName: runtime.model,
		};
	}
}

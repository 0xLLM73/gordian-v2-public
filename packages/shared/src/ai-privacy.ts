import { canRunLocalCommitmentExtraction } from './commitment-ai';
import { getKnowledgeEmbeddingRuntime } from './knowledge-ai';

type EnvLike = Record<string, string | undefined>;

export function isAiProcessingEnabled(env: EnvLike = process.env): boolean {
	return env.AI_PROCESSING_ENABLED === 'true' || env.NODE_ENV === 'test';
}

export function isVendorAiEgressEnabled(env: EnvLike = process.env): boolean {
	return isAiProcessingEnabled(env);
}

export function isLocalOnlyMode(env: EnvLike = process.env): boolean {
	return !isVendorAiEgressEnabled(env);
}

function commitmentLlmProvider(env: EnvLike): string {
	return env.COMMITMENT_LLM_PROVIDER?.trim() || 'cloud';
}

export function canRunCloudCommitmentIntelligence(env: EnvLike = process.env): boolean {
	const provider = commitmentLlmProvider(env);
	return (
		isVendorAiEgressEnabled(env) &&
		env.COMMITMENT_CLOUD_AI_ENABLED !== 'false' &&
		provider !== 'local' &&
		provider !== 'disabled'
	);
}

export function canRunCloudRationaleExtraction(env: EnvLike = process.env): boolean {
	return isVendorAiEgressEnabled(env) && env.RATIONALE_CLOUD_AI_ENABLED !== 'false';
}

export function canRunLocalEmbeddingGeneration(env: EnvLike = process.env): boolean {
	try {
		return getKnowledgeEmbeddingRuntime(env).isLocal;
	} catch {
		return false;
	}
}

export function canRunEmbeddingGeneration(env: EnvLike = process.env): boolean {
	return isVendorAiEgressEnabled(env) || canRunLocalEmbeddingGeneration(env);
}

export function canRunCommitmentExtraction(env: EnvLike = process.env): boolean {
	return (
		canRunCloudCommitmentIntelligence(env) ||
		(canRunLocalCommitmentExtraction(env) && canRunEmbeddingGeneration(env))
	);
}

export function isAiAnalysisAvailable(env: EnvLike = process.env): boolean {
	const explicitVendorEgress = env.AI_PROCESSING_ENABLED === 'true';
	const localEmbeddings = canRunLocalEmbeddingGeneration(env);
	return (
		explicitVendorEgress ||
		localEmbeddings ||
		(canRunLocalCommitmentExtraction(env) && (explicitVendorEgress || localEmbeddings))
	);
}

export function assertAiProcessingEnabled(
	operation = 'AI processing',
	env: EnvLike = process.env,
): void {
	if (!isAiProcessingEnabled(env)) {
		throw new Error(
			`${operation} is disabled. Set AI_PROCESSING_ENABLED=true to allow vendor egress.`,
		);
	}
}

export function getHeliconeApiKey(env: EnvLike = process.env): string | undefined {
	if (!isAiProcessingEnabled(env) || env.HELICONE_ENABLED !== 'true') return undefined;
	return env.HELICONE_API_KEY?.trim() || undefined;
}

export function isHeliconeEnabled(env: EnvLike = process.env): boolean {
	return Boolean(getHeliconeApiKey(env));
}

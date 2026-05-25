import { describe, expect, it } from 'vitest';
import {
	assertAiProcessingEnabled,
	canRunCloudCommitmentIntelligence,
	canRunCloudRationaleExtraction,
	canRunCommitmentExtraction,
	canRunEmbeddingGeneration,
	canRunLocalEmbeddingGeneration,
	getHeliconeApiKey,
	isAiAnalysisAvailable,
	isAiProcessingEnabled,
	isLocalOnlyMode,
	isVendorAiEgressEnabled,
} from '../ai-privacy';

describe('AI privacy gates', () => {
	it('keeps AI processing disabled by default outside tests', () => {
		expect(isAiProcessingEnabled({})).toBe(false);
		expect(() => assertAiProcessingEnabled('Embedding', {})).toThrow(/AI_PROCESSING_ENABLED=true/);
	});

	it('enables AI processing only by explicit env opt-in or test mode', () => {
		expect(isAiProcessingEnabled({ AI_PROCESSING_ENABLED: 'true' })).toBe(true);
		expect(isAiProcessingEnabled({ NODE_ENV: 'test' })).toBe(true);
		expect(isAiProcessingEnabled({ AI_PROCESSING_ENABLED: 'false' })).toBe(false);
	});

	it('keeps Helicone disabled unless both AI and Helicone are explicitly enabled', () => {
		expect(
			getHeliconeApiKey({
				AI_PROCESSING_ENABLED: 'true',
				HELICONE_API_KEY: 'helicone-key',
			}),
		).toBeUndefined();
		expect(
			getHeliconeApiKey({
				AI_PROCESSING_ENABLED: 'true',
				HELICONE_ENABLED: 'true',
				HELICONE_API_KEY: 'helicone-key',
			}),
		).toBe('helicone-key');
	});

	it('separates local-only mode from vendor egress mode', () => {
		expect(isVendorAiEgressEnabled({})).toBe(false);
		expect(isLocalOnlyMode({})).toBe(true);
		expect(isVendorAiEgressEnabled({ AI_PROCESSING_ENABLED: 'true' })).toBe(true);
		expect(isLocalOnlyMode({ AI_PROCESSING_ENABLED: 'true' })).toBe(false);
	});

	it('keeps cloud commitment and rationale work opt-outable even when vendor egress is on', () => {
		expect(canRunCloudCommitmentIntelligence({})).toBe(false);
		expect(canRunCloudRationaleExtraction({})).toBe(false);
		expect(canRunCloudCommitmentIntelligence({ AI_PROCESSING_ENABLED: 'true' })).toBe(true);
		expect(canRunCloudRationaleExtraction({ AI_PROCESSING_ENABLED: 'true' })).toBe(true);
		expect(
			canRunCloudCommitmentIntelligence({
				AI_PROCESSING_ENABLED: 'true',
				COMMITMENT_CLOUD_AI_ENABLED: 'false',
			}),
		).toBe(false);
		expect(
			canRunCloudRationaleExtraction({
				AI_PROCESSING_ENABLED: 'true',
				RATIONALE_CLOUD_AI_ENABLED: 'false',
			}),
		).toBe(false);
	});

	it('keeps local Qwen commitment extraction separate from vendor egress', () => {
		const localQwenEnv = {
			AI_PROCESSING_ENABLED: 'false',
			COMMITMENT_LLM_PROVIDER: 'local',
			COMMITMENT_LLM_BASE_URL: 'http://localhost:11434/v1',
			COMMITMENT_LLM_MODEL: 'qwen3:4b-instruct',
			KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			KNOWLEDGE_EMBEDDING_PRESET: 'qwen',
			KNOWLEDGE_EMBEDDING_MODEL: 'qwen3-embedding:0.6b',
			KNOWLEDGE_EMBEDDING_DIMENSIONS: '512',
		};

		expect(isVendorAiEgressEnabled(localQwenEnv)).toBe(false);
		expect(canRunCloudCommitmentIntelligence(localQwenEnv)).toBe(false);
		expect(canRunLocalEmbeddingGeneration(localQwenEnv)).toBe(true);
		expect(canRunEmbeddingGeneration(localQwenEnv)).toBe(true);
		expect(canRunCommitmentExtraction(localQwenEnv)).toBe(true);
		expect(isAiAnalysisAvailable(localQwenEnv)).toBe(true);
	});

	it('does not allow local commitment extraction without a compatible embedding path', () => {
		const localCommitmentOnly = {
			AI_PROCESSING_ENABLED: 'false',
			COMMITMENT_LLM_PROVIDER: 'local',
			COMMITMENT_LLM_BASE_URL: 'http://localhost:11434/v1',
			COMMITMENT_LLM_MODEL: 'qwen3:4b-instruct',
		};

		expect(canRunEmbeddingGeneration(localCommitmentOnly)).toBe(false);
		expect(canRunCommitmentExtraction(localCommitmentOnly)).toBe(false);
	});

	it('lets the commitment provider disable cloud extraction even when vendor egress is on', () => {
		expect(
			canRunCloudCommitmentIntelligence({
				AI_PROCESSING_ENABLED: 'true',
				COMMITMENT_LLM_PROVIDER: 'local',
				KNOWLEDGE_EMBEDDING_PROVIDER: 'local',
			}),
		).toBe(false);
		expect(
			canRunCloudCommitmentIntelligence({
				AI_PROCESSING_ENABLED: 'true',
				COMMITMENT_LLM_PROVIDER: 'disabled',
			}),
		).toBe(false);
	});
});

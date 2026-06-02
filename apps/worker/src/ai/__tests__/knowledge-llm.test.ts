import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithGemini = vi.hoisted(() => vi.fn());

vi.mock('../gemini-inference', () => ({
	inferWithGemini: mockInferWithGemini,
}));

import { inferKnowledgeEntitiesJson, parseKnowledgeEntityJson } from '../knowledge-llm';

describe('knowledge LLM provider', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					choices: [
						{
							message: {
								content: JSON.stringify({
									entities: [
										{
											confidence: 0.91,
											description: 'Layer 1 blockchain',
											displayName: 'Solana',
											name: 'solana',
											relationshipType: 'works_on',
											type: 'technology',
										},
									],
								}),
							},
						},
					],
				}),
		});
	});

	it('parses schema-compatible JSON and filters low confidence entities', () => {
		const entities = parseKnowledgeEntityJson(
			JSON.stringify({
				entities: [
					{
						confidence: 0.8,
						description: 'DePIN wireless network',
						displayName: 'Helium',
						name: 'helium',
						relationshipType: 'interested_in',
						type: 'project',
					},
					{
						confidence: 0.2,
						description: 'Too weak',
						displayName: 'Weak',
						name: 'weak',
						relationshipType: 'knows_about',
						type: 'topic',
					},
				],
			}),
		);

		expect(entities).toHaveLength(1);
		expect(entities[0].name).toBe('helium');
	});

	it('accepts common local-model JSON variants without weakening schema validation', () => {
		const entities = parseKnowledgeEntityJson(`Here is the extracted JSON:
{
  "extracted_entities": [
    {
      "confidence": "0.92",
      "description": "Open-source vector database",
      "display_name": "Qdrant",
      "name": "qdrant",
      "relationship_type": "uses",
      "source_mention": "testing Qdrant locally",
      "type": "technology"
    },
    {
      "confidence": 0.95,
      "description": "Unsupported relation should be dropped",
      "displayName": "Invalid",
      "name": "invalid",
      "relationshipType": "mentions",
      "type": "topic"
    }
  ]
}`);

		expect(entities).toHaveLength(1);
		expect(entities[0]).toEqual(
			expect.objectContaining({
				confidence: 0.92,
				displayName: 'Qdrant',
				name: 'qdrant',
				relationshipType: 'uses',
				sourceMention: 'testing Qdrant locally',
				type: 'technology',
			}),
		);
	});

	it('accepts a top-level entity array from local models', () => {
		const entities = parseKnowledgeEntityJson(
			JSON.stringify([
				{
					confidence: 0.88,
					description: 'Customer relationship management',
					displayName: 'CRM',
					name: 'crm',
					relationshipType: 'interested_in',
					type: 'concept',
				},
			]),
		);

		expect(entities).toHaveLength(1);
		expect(entities[0].name).toBe('crm');
	});

	it('routes local KG extraction to an OpenAI-compatible chat endpoint', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_LLM_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('KNOWLEDGE_LLM_MODEL', 'local-json-model');

		const result = await inferKnowledgeEntitiesJson({
			systemPrompt: 'Extract entities',
			userPrompt: 'Messages',
		});

		expect(mockInferWithGemini).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/v1/chat/completions',
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.any(String),
				}),
			}),
		);

		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			model: string;
			messages: Array<{ role: string; content: string }>;
			response_format: { type: string };
		};
		expect(body.model).toBe('local-json-model');
		expect(body.response_format).toEqual({ type: 'json_object' });
		expect(body.messages).toEqual([
			{ role: 'system', content: 'Extract entities' },
			{ role: 'user', content: 'Messages' },
		]);
		expect(result.source).toBe('local:local-json-model');
		expect(result.entities[0].name).toBe('solana');
	});

	it('uses Gemini for default cloud KG extraction', async () => {
		mockInferWithGemini.mockResolvedValue(
			JSON.stringify({
				entities: [
					{
						confidence: 0.9,
						description: 'Layer 2 network',
						displayName: 'Base',
						name: 'base',
						relationshipType: 'uses',
						type: 'technology',
					},
				],
			}),
		);

		const result = await inferKnowledgeEntitiesJson({
			systemPrompt: 'Extract entities',
			userPrompt: 'Messages',
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(mockInferWithGemini).toHaveBeenCalledWith({
			systemPrompt: 'Extract entities',
			userPrompt: 'Messages',
		});
		expect(result.source).toBe('gemini_flash');
		expect(result.entities[0].name).toBe('base');
	});

	it('returns no entities when KG LLM extraction is disabled', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'disabled');

		const result = await inferKnowledgeEntitiesJson({
			systemPrompt: 'Extract entities',
			userPrompt: 'Messages',
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(mockInferWithGemini).not.toHaveBeenCalled();
		expect(result).toEqual({ entities: [], source: 'disabled' });
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithGemini = vi.hoisted(() => vi.fn());

vi.mock('../gemini-inference', () => ({
	inferWithGemini: mockInferWithGemini,
}));

import {
	inferKnowledgeEntitiesJson,
	parseKnowledgeEntityJson,
	parseKnowledgeInferenceJson,
} from '../knowledge-llm';

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

	it('parses relationship edges with local-model key variants and aliases', () => {
		const parsed = parseKnowledgeInferenceJson(
			JSON.stringify({
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
				relationships: [
					{
						confidence: '0.86',
						confirmed_eligible: 'yes',
						head_mention: 'Solana',
						is_explicit: true,
						negated: 'false',
						quote: 'Solana depends on Jito for this rollout',
						relation_type: 'DEPENDS',
						source_message_id: 'msg-1',
						tail_mention: 'Jito',
						temporal_status: 'current',
					},
				],
			}),
		);

		expect(parsed.entities).toHaveLength(1);
		expect(parsed.relations).toEqual([
			expect.objectContaining({
				confidence: 0.86,
				confirmedEligible: true,
				headMention: 'Solana',
				isExplicit: true,
				negated: false,
				quote: 'Solana depends on Jito for this rollout',
				relationType: 'depends_on',
				sourceMessageId: 'msg-1',
				tailMention: 'Jito',
				temporalStatus: 'current',
			}),
		]);
	});

	it('parses Qwen-style subject predicate object relationship fields', () => {
		const parsed = parseKnowledgeInferenceJson(
			JSON.stringify({
				relations: [
					{
						confidence: 0.8,
						object_node: 'Solana payment rails rollout',
						predicate: 'working_on',
						quote: 'Ben is working on the Solana payment rails rollout',
						source_message_id: '[source:m1]',
						subject_node: 'Ben',
					},
				],
			}),
		);

		expect(parsed.relations).toEqual([
			expect.objectContaining({
				headMention: 'Ben',
				relationType: 'works_on',
				tailMention: 'Solana payment rails rollout',
			}),
		]);
	});

	it('normalizes local-model relation and temporal variants conservatively', () => {
		const parsed = parseKnowledgeInferenceJson(
			JSON.stringify({
				relations: [
					{
						confirmed_eligible: false,
						head_mention: 'Jordan',
						is_explicit: true,
						negated: false,
						quote: 'Jordan works with Orbit Labs',
						relation_type: 'WORKS_WITH',
						source_message_id: 'm1',
						tail_mention: 'Orbit Labs',
						temporal_status: 'current_state_negation_of_past_affiliation',
					},
					{
						confirmed_eligible: false,
						head_mention: 'we',
						is_explicit: true,
						negated: false,
						quote: 'We used to use HubSpot',
						relation_type: 'USED_TO_USE',
						source_message_id: 'm2',
						tail_mention: 'HubSpot',
						temporal_status: 'historical',
					},
				],
			}),
		);

		expect(parsed.relations).toEqual([
			expect.objectContaining({
				relationType: 'affiliated_with',
				temporalStatus: 'past',
			}),
			expect.objectContaining({
				relationType: 'uses',
				temporalStatus: 'past',
			}),
		]);
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
		expect(result).toEqual({ entities: [], relations: [], source: 'disabled' });
	});
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeBrowser } from './knowledge-browser';

const mockGetKnowledgeAnalysisEstimateAction = vi.hoisted(() => vi.fn());
const mockGetKnowledgeAnalysisProgressAction = vi.hoisted(() => vi.fn());
const mockGetKnowledgeRelationshipExplanationsAction = vi.hoisted(() => vi.fn());
const mockRunLocalKnowledgeAnalysisAction = vi.hoisted(() => vi.fn());
const mockRunLocalKnowledgeInferenceAction = vi.hoisted(() => vi.fn());
const mockCreateManualKnowledgeNodeAction = vi.hoisted(() => vi.fn());
const mockReviewKnowledgeNodeAction = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeNodesWithEvidenceAction = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/knowledge', () => ({
	createManualKnowledgeNodeAction: mockCreateManualKnowledgeNodeAction,
	getKnowledgeAnalysisEstimateAction: mockGetKnowledgeAnalysisEstimateAction,
	getKnowledgeAnalysisProgressAction: mockGetKnowledgeAnalysisProgressAction,
	getKnowledgeRelationshipExplanationsAction: mockGetKnowledgeRelationshipExplanationsAction,
	listKnowledgeNodesAction: vi.fn(),
	reviewKnowledgeNodeAction: mockReviewKnowledgeNodeAction,
	runLocalKnowledgeAnalysisAction: mockRunLocalKnowledgeAnalysisAction,
	runLocalKnowledgeInferenceAction: mockRunLocalKnowledgeInferenceAction,
	searchKnowledgeNodesWithEvidenceAction: mockSearchKnowledgeNodesWithEvidenceAction,
}));

vi.mock('@/components/knowledge/knowledge-graph', () => ({
	KnowledgeGraph: () => React.createElement('div', null, 'graph'),
}));

vi.mock('next/link', () => ({
	default: ({
		href,
		children,
		className,
	}: {
		href: string;
		children: React.ReactNode;
		className?: string;
	}) => React.createElement('a', { href, className }, children),
}));

describe('KnowledgeBrowser evidence-aware search cards', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetKnowledgeAnalysisEstimateAction.mockResolvedValue({
			data: {
				canRun: true,
				contactsEstimated: 2,
				enabled: true,
				embeddingProviderLabel: 'Nomic local embeddings',
				embeddingProviderMode: 'local',
				embeddingInputsEstimated: 7,
				hasConsent: true,
				llmProviderLabel: 'local LLM',
				llmProviderMode: 'local',
				llmRequestsEstimated: 2,
				messagesEstimated: 12,
				mode: 'incremental',
			},
		});
		mockGetKnowledgeAnalysisProgressAction.mockResolvedValue({
			data: {
				stage: 'llm',
				percent: 65,
				processedContacts: 2,
				expectedContacts: 2,
				llmCompleted: 1,
				expectedLlmRequests: 2,
				entitiesExtracted: 3,
				nodeCount: 2,
				evidenceCount: 3,
				linkCount: 0,
				latestUpdateAt: '2026-05-17T00:00:00.000Z',
				complete: false,
			},
		});
		mockRunLocalKnowledgeAnalysisAction.mockResolvedValue({
			data: { queued: true, mode: 'full', status: 'started' },
		});
		mockRunLocalKnowledgeInferenceAction.mockResolvedValue({
			data: {
				coOccurrenceLinks: 2,
				nodesProcessed: 2,
				similarityLinks: 1,
				status: 'complete',
				totalLinks: 3,
			},
		});
		mockCreateManualKnowledgeNodeAction.mockResolvedValue({
			data: {
				created: true,
				buildQueued: false,
				buildStatus: 'complete',
				analysis: {
					contactsProcessed: 13,
					embeddingMatches: 2,
					llmQueued: 0,
					batchLinked: 0,
					batchUsed: false,
					elapsedMs: 1200,
				},
				manualEvidence: {
					contactsScanned: 13,
					messagesScanned: 1200,
					evidenceCreated: 2,
					contactsLinked: 2,
					totalEvidenceRows: 7,
					totalEvidenceContacts: 3,
					totalEvidenceMessages: 6,
				},
				inference: {
					status: 'complete',
					nodesProcessed: 8,
					coOccurrenceLinks: 4,
					similarityLinks: 15,
					totalLinks: 19,
				},
				node: {
					id: 'node-manual',
					type: 'topic',
					name: 'berachain',
					displayName: 'Berachain',
					description: 'Ecosystem context',
					mentionCount: 1,
					lastSeenAt: null,
				},
			},
		});
		mockReviewKnowledgeNodeAction.mockResolvedValue({
			data: {
				updated: true,
				node: {
					id: 'node-1',
					type: 'topic',
					name: 'helium',
					displayName: 'Helium Network',
					description: 'Reviewed DePIN wireless network',
					mentionCount: 3,
					lastSeenAt: null,
					reviewStatus: 'reviewed',
					reviewedAt: '2026-05-17T00:00:00.000Z',
				},
			},
		});
		mockGetKnowledgeRelationshipExplanationsAction.mockResolvedValue({
			data: {
				explanations: [
					{
						id: 'rel-1',
						direction: 'outbound',
						linkType: 'related_to',
						weight: 0.84,
						neighbor: {
							id: 'node-2',
							type: 'project',
							name: 'akash',
							displayName: 'Akash',
							description: null,
							mentionCount: 1,
							lastSeenAt: null,
						},
						explanation:
							'A strong inferred relationship from shared contacts or semantic similarity.',
						evidence: [],
					},
				],
			},
		});
		mockSearchKnowledgeNodesWithEvidenceAction.mockResolvedValue({
			data: {
				query: 'who talked about helium',
				normalizedQuery: 'helium',
				noConfidentResults: false,
				answer: {
					title: 'Helium is the strongest local match for "helium".',
					summary:
						'1 topic matched with 1 connected contact and 1 source evidence row. Top match confidence is 87%.',
					support: ['1 contact connected', '1 evidence row stored'],
					suggestedAction:
						'Open the top topic to inspect the supporting contacts and source snippets.',
				},
				results: [
					{
						node: {
							id: 'node-1',
							type: 'topic',
							name: 'helium',
							displayName: 'Helium',
							description: 'DePIN wireless network',
							mentionCount: 3,
							lastSeenAt: null,
						},
						matchScore: 0.87,
						similarity: 0.8,
						matchReasons: ['semantic similarity'],
						messageHitCount: 1,
						messageMatchedEvidenceIds: ['evidence-1'],
						evidenceCount: 1,
						aggregateEvidenceCount: 1,
						connectedContactCount: 1,
						connectedContactsWithEvidence: 1,
						contacts: [],
						evidence: [
							{
								id: 'evidence-1',
								contactId: 'contact-1',
								messageId: 'message-1',
								relationType: 'knows_about',
								evidenceKind: 'llm_extracted',
								claimLabel: 'explicit',
								confidence: 0.91,
								snippet: 'Alice said she is tracking Helium hotspots.',
								occurredAt: new Date('2026-05-02T12:00:00Z'),
								createdAt: new Date('2026-05-02T12:00:00Z'),
							},
						],
					},
				],
			},
		});
	});

	it('shows local analysis work estimates and queues the selected mode', async () => {
		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [
					{
						id: 'node-1',
						type: 'topic',
						name: 'helium',
						displayName: 'Helium',
						description: 'DePIN wireless network',
						mentionCount: 3,
						lastSeenAt: new Date('2026-05-01T12:00:00Z'),
						evidenceCount: 4,
						contactCount: 2,
					},
					{
						id: 'node-2',
						type: 'project',
						name: 'akash',
						displayName: 'Akash',
						description: null,
						mentionCount: 1,
						lastSeenAt: null,
						aggregateEvidenceCount: 3,
						connectedContactCount: 1,
					},
				],
				messageCoverage: {
					chatsWithNullContactMessages: 3,
					linkedContactMessages: 75,
					messagesWithSenderMetadata: 25,
					messagesWithUserSenderMetadata: 20,
					nullContactMessages: 25,
					nullContactMessagesWithSenderMetadata: 0,
					nullContactMessagesWithUserSenderMetadata: 0,
					totalMessages: 100,
				},
			}),
		);

		expect(screen.getByText('Local analysis')).toBeTruthy();
		await waitFor(() => expect(screen.getByText('2 contacts')).toBeTruthy());
		expect(screen.getByText('12 messages')).toBeTruthy();
		expect(screen.getByText('7 embedding inputs')).toBeTruthy();
		expect(screen.getByText('Nomic local embeddings')).toBeTruthy();
		expect(screen.getByText('2 local LLM calls')).toBeTruthy();
		expect(screen.getByText('Mode: Incremental')).toBeTruthy();
		expect(screen.getByText('Imported')).toBeTruthy();
		expect(screen.getByText('100')).toBeTruthy();
		expect(screen.getByText('Contact-linked')).toBeTruthy();
		expect(screen.getByText('75%')).toBeTruthy();
		expect(screen.getByText('Sender-attributed')).toBeTruthy();
		expect(screen.getByText('20%')).toBeTruthy();
		expect(screen.getByText('Needs attribution')).toBeTruthy();
		expect(screen.getByText('25')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: /Full rebuild/i }));
		await waitFor(() =>
			expect(mockGetKnowledgeAnalysisEstimateAction).toHaveBeenLastCalledWith({
				mode: 'full',
				limit: 500,
			}),
		);
		expect(screen.getByText('Mode: Full rebuild')).toBeTruthy();

		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Run analysis' })).toHaveProperty(
				'disabled',
				false,
			),
		);
		fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
		await waitFor(() =>
			expect(mockRunLocalKnowledgeAnalysisAction).toHaveBeenCalledWith({
				mode: 'full',
				limit: 500,
			}),
		);
		expect(screen.getByText(/Last queued Full rebuild at/)).toBeTruthy();
		await waitFor(() =>
			expect(mockGetKnowledgeAnalysisProgressAction).toHaveBeenCalledWith(
				expect.objectContaining({
					expectedContacts: 2,
					expectedLlmRequests: 2,
				}),
			),
		);
		expect(screen.getByText('Local LLM extraction')).toBeTruthy();
		expect(screen.getByText('65%')).toBeTruthy();
		expect(screen.getByText('Contacts 2/2')).toBeTruthy();
		expect(screen.getByText('Local LLM 1/2 estimated')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Build relationships' }));
		await waitFor(() => expect(mockRunLocalKnowledgeInferenceAction).toHaveBeenCalledWith({}));
		await waitFor(() =>
			expect(screen.getByText('Relationships: 3 links from 2 nodes')).toBeTruthy(),
		);
	});

	it('disables model-backed knowledge actions when AI consent is missing', async () => {
		mockGetKnowledgeAnalysisEstimateAction.mockResolvedValueOnce({
			data: {
				canRun: false,
				contactsEstimated: 0,
				enabled: true,
				embeddingProviderLabel: 'Nomic local embeddings',
				embeddingProviderMode: 'local',
				embeddingInputsEstimated: 0,
				hasConsent: false,
				llmProviderLabel: 'local LLM',
				llmProviderMode: 'local',
				llmRequestsEstimated: 0,
				messagesEstimated: 0,
				mode: 'incremental',
			},
		});

		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [
					{
						id: 'node-1',
						type: 'topic',
						name: 'helium',
						displayName: 'Helium',
						description: 'DePIN wireless network',
						mentionCount: 3,
						lastSeenAt: new Date('2026-05-01T12:00:00Z'),
						evidenceCount: 4,
						contactCount: 2,
					},
					{
						id: 'node-2',
						type: 'project',
						name: 'akash',
						displayName: 'Akash',
						description: null,
						mentionCount: 1,
						lastSeenAt: null,
						aggregateEvidenceCount: 3,
						connectedContactCount: 1,
					},
				],
			}),
		);

		await screen.findByText('Consent required');
		expect(screen.getByRole('button', { name: 'Run analysis' })).toHaveProperty('disabled', true);
		expect(screen.getByRole('button', { name: 'Build relationships' })).toHaveProperty(
			'disabled',
			true,
		);
		expect(screen.getByRole('link', { name: 'Enable AI analysis in Settings' })).toHaveProperty(
			'href',
			'http://localhost:3000/settings',
		);
	});

	it('creates a manual knowledge node and shows the completed local build summary', async () => {
		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [],
			}),
		);

		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Berachain' } });
		fireEvent.change(screen.getByLabelText('Context'), {
			target: { value: 'Ecosystem context' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add knowledge' }));

		await waitFor(() =>
			expect(mockCreateManualKnowledgeNodeAction).toHaveBeenCalledWith({
				type: 'topic',
				name: 'Berachain',
				description: 'Ecosystem context',
				buildNow: true,
			}),
		);
		await waitFor(() => expect(screen.getAllByText('Berachain').length).toBeGreaterThan(0));
		expect(screen.getByText(/build complete/)).toBeTruthy();
		expect(screen.getAllByText(/13 contacts/).length).toBeGreaterThan(0);
		expect(screen.getByText(/2 new evidence rows/)).toBeTruthy();
		expect(screen.getAllByText(/7 total evidence rows/).length).toBeGreaterThan(0);
		expect(screen.getByText(/3 contacts, 6 messages/)).toBeTruthy();
		expect(screen.getAllByText(/19 links/).length).toBeGreaterThan(0);
		expect(screen.getByText('Evidence')).toBeTruthy();
		expect(screen.getByText('Relationships')).toBeTruthy();
	});

	it('queues manual knowledge evidence builds and starts progress polling', async () => {
		mockCreateManualKnowledgeNodeAction.mockResolvedValueOnce({
			data: {
				created: true,
				buildQueued: true,
				buildStatus: 'started',
				node: {
					id: 'node-manual',
					type: 'topic',
					name: 'berachain',
					displayName: 'Berachain',
					description: 'Ecosystem context',
					mentionCount: 1,
					lastSeenAt: null,
				},
			},
		});

		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [],
			}),
		);

		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Berachain' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add knowledge' }));

		await waitFor(() =>
			expect(mockCreateManualKnowledgeNodeAction).toHaveBeenCalledWith({
				type: 'topic',
				name: 'Berachain',
				description: undefined,
				buildNow: true,
			}),
		);
		await waitFor(() =>
			expect(mockGetKnowledgeAnalysisEstimateAction).toHaveBeenCalledWith({
				mode: 'evidence',
				limit: 500,
			}),
		);
		await waitFor(() => expect(screen.getByText('local evidence build queued')).toBeTruthy());
		expect(screen.getByText('Queued in local worker')).toBeTruthy();
		await waitFor(() => expect(mockGetKnowledgeAnalysisProgressAction).toHaveBeenCalled());
	});

	it('shows answer-style search results from evidence search', async () => {
		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [],
			}),
		);

		fireEvent.change(screen.getByPlaceholderText('Search topics, projects, communities...'), {
			target: { value: 'who talked about helium' },
		});

		await waitFor(() =>
			expect(mockSearchKnowledgeNodesWithEvidenceAction).toHaveBeenCalledWith({
				query: 'who talked about helium',
				limit: 50,
			}),
		);
		await waitFor(() =>
			expect(screen.getByText('Helium is the strongest local match for "helium".')).toBeTruthy(),
		);
		expect(screen.getByText('1 contact connected')).toBeTruthy();
		expect(screen.getByText('Alice said she is tracking Helium hotspots.')).toBeTruthy();
	});

	it('saves review corrections from a knowledge card', async () => {
		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [
					{
						id: 'node-1',
						type: 'topic',
						name: 'helium',
						displayName: 'Helium',
						description: 'DePIN wireless network',
						mentionCount: 3,
						lastSeenAt: null,
						evidenceCount: 1,
					},
				],
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Review' }));
		fireEvent.change(screen.getAllByLabelText('Name')[1] as HTMLElement, {
			target: { value: 'Helium Network' },
		});
		fireEvent.change(screen.getAllByLabelText('Context')[1] as HTMLElement, {
			target: { value: 'Reviewed DePIN wireless network' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

		await waitFor(() =>
			expect(mockReviewKnowledgeNodeAction).toHaveBeenCalledWith({
				nodeId: 'node-1',
				type: 'topic',
				displayName: 'Helium Network',
				description: 'Reviewed DePIN wireless network',
				status: 'reviewed',
			}),
		);
		await waitFor(() => expect(screen.getByText('Review saved')).toBeTruthy());
		expect(screen.getByText('Reviewed')).toBeTruthy();
	});

	it('loads why-connected explanations for a card', async () => {
		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [
					{
						id: 'node-1',
						type: 'topic',
						name: 'helium',
						displayName: 'Helium',
						description: 'DePIN wireless network',
						mentionCount: 3,
						lastSeenAt: null,
						evidenceCount: 1,
					},
				],
			}),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Why connected?' }));

		await waitFor(() =>
			expect(mockGetKnowledgeRelationshipExplanationsAction).toHaveBeenCalledWith({
				nodeId: 'node-1',
				limit: 4,
			}),
		);
		await waitFor(() =>
			expect(
				screen.getByText(
					'A strong inferred relationship from shared contacts or semantic similarity.',
				),
			).toBeTruthy(),
		);
		expect(screen.getByText('Relationship explanations')).toBeTruthy();
		expect(screen.getByText('Akash')).toBeTruthy();
	});

	it('shows message recall labels, evidence snippet, and timestamp fields', async () => {
		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [
					{
						id: 'node-1',
						type: 'topic',
						name: 'helium',
						displayName: 'Helium',
						description: 'DePIN wireless network',
						mentionCount: 3,
						lastSeenAt: new Date('2026-05-01T12:00:00Z'),
						matchScore: 0.87,
						topConfidence: 0.91,
						messageHitCount: 2,
						messageMatchedEvidenceIds: ['evidence-1'],
						messageMatchedAt: new Date('2026-05-02T12:00:00Z'),
						evidenceCount: 1,
						latestEvidenceAt: new Date('2026-05-02T12:00:00Z'),
						contacts: [
							{
								id: 'contact-1',
								firstName: 'Alice',
								lastName: 'Smith',
								relationType: 'knows_about',
								strength: 0.9,
								evidenceCount: 1,
								lastEvidenceAt: new Date('2026-05-02T12:00:00Z'),
								evidence: [],
							},
						],
						evidence: [
							{
								id: 'evidence-1',
								contactId: 'contact-1',
								messageId: 'message-1',
								relationType: 'knows_about',
								evidenceKind: 'llm_extracted',
								claimLabel: 'explicit',
								confidence: 0.91,
								snippet: 'Alice said she is tracking Helium hotspots.',
								occurredAt: new Date('2026-05-02T12:00:00Z'),
								createdAt: new Date('2026-05-02T12:00:00Z'),
							},
						],
					},
				],
			}),
		);
		await waitFor(() => expect(screen.getByText('2 contacts')).toBeTruthy());

		expect(screen.getByText('Matched in message evidence')).toBeTruthy();
		expect(screen.getByText('2 message matches')).toBeTruthy();
		expect(screen.getByText('message match')).toBeTruthy();
		expect(screen.getByText('Alice Smith - knows about')).toBeTruthy();
		expect(screen.getByText('Alice said she is tracking Helium hotspots.')).toBeTruthy();
	});

	it('keeps the legacy no-evidence fallback for aggregate-only rows', async () => {
		render(
			React.createElement(KnowledgeBrowser, {
				initialNodes: [
					{
						id: 'node-legacy',
						type: 'topic',
						name: 'crm',
						displayName: 'CRM automation',
						description: null,
						mentionCount: 1,
						lastSeenAt: null,
						matchScore: 0.7,
						evidenceCount: 0,
						aggregateEvidenceCount: 2,
						contacts: [],
						evidence: [],
					},
				],
			}),
		);
		await waitFor(() => expect(screen.getByText('2 contacts')).toBeTruthy());

		expect(
			screen.getByText('This topic exists, but no source message evidence has been stored yet.'),
		).toBeTruthy();
	});
});

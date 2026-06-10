import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DealLocalAiPanel, type SerializableDealAiRun } from './deal-local-ai-panel';

vi.stubGlobal('React', React);

const mockGenerate = vi.hoisted(() => vi.fn());
const mockUpdateStatus = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/deals', () => ({
	generateDealLocalAiAction: mockGenerate,
	updateDealAiRunStatusAction: mockUpdateStatus,
}));

const disabledStatus = {
	chatConfigured: false,
	chatLabel: 'cloud chat',
	chatModel: 'not configured',
	chatSource: 'default',
	embeddingLabel: 'Nomic local embeddings',
	embeddingModel: 'nomic-embed-text',
	knowledgeLabel: 'Knowledge extraction disabled',
	knowledgeModel: 'not configured',
	localOnly: false,
	liveModelEnabled: false,
	vendorEgressEnabled: false,
};

const configuredStatus = {
	...disabledStatus,
	chatConfigured: true,
	chatLabel: 'Qwen local chat',
	chatModel: 'qwen3.5:9b',
	chatSource: 'chat',
	localOnly: true,
};

const liveConfiguredStatus = {
	...configuredStatus,
	liveModelEnabled: true,
};

const run: SerializableDealAiRun = {
	id: '550e8400-e29b-41d4-a716-446655440099',
	runType: 'commitment_suggestion',
	status: 'draft',
	modelRole: 'deterministic_fallback',
	modelName: 'local-context-rules',
	localVendorMode: 'deterministic_fallback',
	output: 'Draft commitment suggestion - requires explicit acceptance.',
	uncertainty: 'High uncertainty.',
	sourceCount: 1,
	createdAt: '2026-06-09T12:00:00Z',
};

describe('DealLocalAiPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerate.mockResolvedValue({
			data: {
				...run,
				id: '550e8400-e29b-41d4-a716-446655440088',
				runType: 'brief',
				output: 'Generated local deal brief.',
				sourceCount: 1,
				createdAt: new Date('2026-06-09T12:00:00Z'),
			},
		});
		mockUpdateStatus.mockResolvedValue({ data: { id: run.id, status: 'accepted' } });
	});

	it('shows unavailable local AI as graceful deterministic fallback', () => {
		render(<DealLocalAiPanel dealId="deal-1" status={disabledStatus} initialRuns={[]} />);

		expect(screen.getByTestId('deal-local-ai-status')).toBeTruthy();
		expect(screen.getByText(/Local AI assistance is not required/)).toBeTruthy();
		expect(screen.getByText('No saved deal AI output yet.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Generate brief' })).toBeTruthy();
	});

	it('generates a saved brief through the action', async () => {
		render(<DealLocalAiPanel dealId="deal-1" status={configuredStatus} initialRuns={[]} />);

		expect(screen.getByText(/live model calls are off/)).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Generate brief' }));

		await waitFor(() =>
			expect(mockGenerate).toHaveBeenCalledWith({ dealId: 'deal-1', runType: 'brief' }),
		);
		expect(await screen.findByText('Generated local deal brief.')).toBeTruthy();
		expect(screen.getByText(/1 source/)).toBeTruthy();
	});

	it('shows live model availability as request-time fallback state', () => {
		render(<DealLocalAiPanel dealId="deal-1" status={liveConfiguredStatus} initialRuns={[]} />);

		expect(screen.getByText(/live calls are enabled/)).toBeTruthy();
		expect(screen.getByText(/Live model: enabled/)).toBeTruthy();
	});

	it('passes evidence questions to the action', async () => {
		render(<DealLocalAiPanel dealId="deal-1" status={configuredStatus} initialRuns={[]} />);

		fireEvent.change(screen.getByLabelText('Ask local deal AI'), {
			target: { value: 'What evidence supports this?' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

		await waitFor(() =>
			expect(mockGenerate).toHaveBeenCalledWith({
				dealId: 'deal-1',
				runType: 'question_answer',
				question: 'What evidence supports this?',
			}),
		);
	});

	it('accepts and dismisses draft suggestions explicitly', async () => {
		render(<DealLocalAiPanel dealId="deal-1" status={configuredStatus} initialRuns={[run]} />);

		fireEvent.click(screen.getByRole('button', { name: 'Accept draft' }));

		await waitFor(() =>
			expect(mockUpdateStatus).toHaveBeenCalledWith({ runId: run.id, status: 'accepted' }),
		);
		expect(await screen.findByText('accepted')).toBeTruthy();
	});

	it('collapses older saved outputs behind a history toggle', () => {
		const runs = Array.from({ length: 6 }, (_, index) => ({
			...run,
			id: `550e8400-e29b-41d4-a716-4466554400${index}`,
			output: `Saved output ${index + 1}`,
		}));

		render(<DealLocalAiPanel dealId="deal-1" status={configuredStatus} initialRuns={runs} />);

		expect(screen.getAllByTestId('deal-ai-run')).toHaveLength(5);
		expect(screen.getByText('Show 1 older')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Show 1 older' }));

		expect(screen.getAllByTestId('deal-ai-run')).toHaveLength(6);
		expect(screen.getByText('Show recent only')).toBeTruthy();
	});
});

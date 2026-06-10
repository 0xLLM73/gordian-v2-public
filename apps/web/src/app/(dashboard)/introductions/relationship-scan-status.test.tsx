import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RelationshipScanStatusPanel } from './relationship-scan-status';

vi.stubGlobal('React', React);

const actionMocks = vi.hoisted(() => ({
	getStatusAction: Symbol('getRelationshipScanStatusAction'),
	cleanupAction: Symbol('cleanupRelationshipScanFailuresAction'),
	getStatus: vi.fn(),
	cleanup: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock('@/app/actions/introductions', () => ({
	getRelationshipScanStatusAction: actionMocks.getStatusAction,
	cleanupRelationshipScanFailuresAction: actionMocks.cleanupAction,
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: actionMocks.refresh }),
}));

vi.mock('next-safe-action/hooks', () => ({
	useAction: vi.fn((action) =>
		action === actionMocks.getStatusAction
			? { executeAsync: actionMocks.getStatus, isExecuting: false }
			: { executeAsync: actionMocks.cleanup, isExecuting: false },
	),
}));

describe('RelationshipScanStatusPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actionMocks.getStatus.mockResolvedValue({ serverError: 'WORKER_URL is not configured' });
		actionMocks.cleanup.mockResolvedValue({ data: { removed: 0 } });
	});

	it('shows an unavailable state when the worker status call fails', async () => {
		render(<RelationshipScanStatusPanel />);

		await waitFor(() => expect(actionMocks.getStatus).toHaveBeenCalled());

		expect(screen.getByText('Unavailable')).toBeTruthy();
		expect(screen.getByText(/Relationship scan status is unavailable/)).toBeTruthy();
		expect(
			screen.getByText(
				'WORKER_URL is not configured. Start the local worker with pnpm --filter worker dev or update WORKER_URL, then refresh scan status.',
			),
		).toBeTruthy();
	});

	it('does not duplicate already-actionable worker errors', async () => {
		actionMocks.getStatus.mockResolvedValueOnce({
			serverError:
				'Could not reach the local worker. Start it with pnpm --filter worker dev or update WORKER_URL, then retry.',
		});

		render(<RelationshipScanStatusPanel />);

		await waitFor(() => expect(actionMocks.getStatus).toHaveBeenCalled());

		expect(
			screen.getByText(
				'Could not reach the local worker. Start it with pnpm --filter worker dev or update WORKER_URL, then retry.',
			),
		).toBeTruthy();
		expect(screen.queryByText(/refresh scan status/)).toBeNull();
	});
});

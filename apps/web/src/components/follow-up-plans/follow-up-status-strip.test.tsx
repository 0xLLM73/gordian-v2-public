import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpStatusStrip } from './follow-up-status-strip';

vi.stubGlobal('React', React);

const baseWorkerHealth = {
	status: 'running' as const,
	label: 'Worker ready',
	detail: 'Last follow-up worker check completed less than a minute ago.',
	lastSeenAt: new Date('2026-06-09T12:00:00Z'),
	ageMs: 1_000,
	staleAfterMs: 7_200_000,
	heartbeatStatus: 'idle' as const,
	processedSteps: 0,
	failedSteps: 0,
};

const baseReadiness = {
	localAi: {
		status: 'ready' as const,
		label: 'Local AI',
		value: 'qwen3.5:9b',
		detail: 'Qwen local chat is configured for follow-up draft generation.',
	},
	telegram: {
		status: 'warning' as const,
		label: 'Telegram',
		value: 'No import yet',
		detail: 'Manual plans still work; imported history improves draft context and reply pauses.',
	},
	notifications: {
		status: 'unknown' as const,
		label: 'Notifications',
		value: 'Optional',
		detail: 'Browser reminders are optional; manual review remains available without them.',
	},
};

describe('FollowUpStatusStrip', () => {
	it('shows worker health alongside follow-up plan counters', () => {
		render(
			<FollowUpStatusStrip
				reviewCount={2}
				overdueCount={1}
				blockedCount={0}
				activeCount={3}
				workerHealth={baseWorkerHealth}
				readiness={baseReadiness}
			/>,
		);

		expect(screen.getByText('Worker')).toBeTruthy();
		expect(screen.getByText('Worker ready')).toBeTruthy();
		expect(screen.getByText('Local AI')).toBeTruthy();
		expect(screen.getByText('qwen3.5:9b')).toBeTruthy();
		expect(screen.getByText('Telegram')).toBeTruthy();
		expect(screen.getByText('No import yet')).toBeTruthy();
		expect(screen.getByText('Notifications')).toBeTruthy();
		expect(screen.getByText('Optional')).toBeTruthy();
		expect(screen.getByText('Needs review')).toBeTruthy();
		expect(screen.getByText('Local drafts waiting')).toBeTruthy();
		expect(screen.getByText('Blocked')).toBeTruthy();
		expect(screen.getByText('Retryable local generation issues')).toBeTruthy();
		expect(screen.getByText('Sending')).toBeTruthy();
		expect(screen.getByText('No automatic sends')).toBeTruthy();
	});

	it('makes a stopped local worker visible', () => {
		render(
			<FollowUpStatusStrip
				reviewCount={0}
				overdueCount={4}
				blockedCount={0}
				activeCount={1}
				workerHealth={{
					...baseWorkerHealth,
					status: 'stale',
					label: 'Worker stopped',
					detail:
						'No follow-up worker heartbeat since 3 hours ago. Due steps wait until the local worker is running; start it with pnpm --filter worker dev.',
					ageMs: 10_800_000,
				}}
				readiness={baseReadiness}
			/>,
		);

		expect(screen.getByText('Stopped')).toBeTruthy();
		expect(
			screen.getByText(
				'No follow-up worker heartbeat since 3 hours ago. Due steps wait until the local worker is running; start it with pnpm --filter worker dev.',
			),
		).toBeTruthy();
	});

	it('makes blocked local generation visible in the strip', () => {
		render(
			<FollowUpStatusStrip
				reviewCount={0}
				overdueCount={1}
				blockedCount={2}
				activeCount={1}
				workerHealth={baseWorkerHealth}
				readiness={baseReadiness}
			/>,
		);

		expect(screen.getByText('Blocked')).toBeTruthy();
		expect(screen.getByText('2')).toBeTruthy();
		expect(screen.getByText('Retryable local generation issues')).toBeTruthy();
	});
});

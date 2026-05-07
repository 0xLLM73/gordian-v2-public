import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.useFakeTimers();

const mockScheduleAIPipeline = vi.hoisted(() => vi.fn());

vi.mock('../ai-flow', () => ({
	scheduleAIPipeline: mockScheduleAIPipeline,
}));

import { bufferMessage, flushAllBuffers, getBufferStats } from '../message-buffer';

const USER = 'user-1';
const CONTACT = 'contact-1';
const WS = 'ws-1';
const MSG = { role: 'user', content: 'encrypted-content', timestamp: '2026-02-28T00:00:00Z' };

describe('message-buffer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockScheduleAIPipeline.mockResolvedValue(undefined);
	});

	afterEach(async () => {
		// Clean up any pending buffers
		await flushAllBuffers();
		vi.clearAllTimers();
	});

	it('buffers messages and flushes after 45s window', async () => {
		bufferMessage(USER, CONTACT, WS, [MSG]);
		bufferMessage(USER, CONTACT, WS, [MSG]);

		expect(mockScheduleAIPipeline).not.toHaveBeenCalled();
		expect(getBufferStats().activeBuffers).toBe(1);
		expect(getBufferStats().totalMessages).toBe(2);

		await vi.advanceTimersByTimeAsync(45_000);

		expect(mockScheduleAIPipeline).toHaveBeenCalledTimes(1);
		expect(mockScheduleAIPipeline).toHaveBeenCalledWith(
			USER,
			CONTACT,
			WS,
			undefined, // keyEnvelope
			[MSG, MSG],
			undefined, // workspaceSalt
			undefined, // commitmentSensitivity
		);
	});

	it('resets debounce timer on new message', async () => {
		bufferMessage(USER, CONTACT, WS, [MSG]);
		await vi.advanceTimersByTimeAsync(30_000); // 30s
		bufferMessage(USER, CONTACT, WS, [MSG]); // Reset timer
		await vi.advanceTimersByTimeAsync(30_000); // 30s more (60s total, but only 30s since last msg)

		expect(mockScheduleAIPipeline).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(15_000); // 45s since last msg
		expect(mockScheduleAIPipeline).toHaveBeenCalledTimes(1);
	});

	it('force-flushes at MAX_BUFFER_SIZE (50)', async () => {
		const messages = Array.from({ length: 50 }, (_, i) => ({
			role: 'user',
			content: `msg-${i}`,
			timestamp: '2026-02-28T00:00:00Z',
		}));

		bufferMessage(USER, CONTACT, WS, messages);

		// flushBuffer is async — allow microtask to settle
		await vi.advanceTimersByTimeAsync(0);

		expect(mockScheduleAIPipeline).toHaveBeenCalledTimes(1);
		expect(mockScheduleAIPipeline.mock.calls[0][4]).toHaveLength(50);
	});

	it('keeps separate buffers per contact', async () => {
		bufferMessage(USER, 'contact-a', WS, [MSG]);
		bufferMessage(USER, 'contact-b', WS, [MSG]);

		expect(getBufferStats().activeBuffers).toBe(2);

		await vi.advanceTimersByTimeAsync(45_000);

		expect(mockScheduleAIPipeline).toHaveBeenCalledTimes(2);
	});

	it('flushAllBuffers drains everything on shutdown', async () => {
		bufferMessage(USER, 'c1', WS, [MSG]);
		bufferMessage(USER, 'c2', WS, [MSG]);
		bufferMessage(USER, 'c3', WS, [MSG]);

		await flushAllBuffers();

		expect(mockScheduleAIPipeline).toHaveBeenCalledTimes(3);
		expect(getBufferStats().activeBuffers).toBe(0);
	});

	it('does not double-flush if timer fires during flushAllBuffers', async () => {
		bufferMessage(USER, CONTACT, WS, [MSG]);
		await flushAllBuffers();
		await vi.advanceTimersByTimeAsync(45_000);

		expect(mockScheduleAIPipeline).toHaveBeenCalledTimes(1);
	});
});

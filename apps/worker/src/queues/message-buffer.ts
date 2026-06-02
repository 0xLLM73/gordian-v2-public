import { redactSensitive } from '@repo/shared';
import type { CommitmentSensitivity } from '../ai/confidence-thresholds';
import type { PipelineMessage } from './ai-flow';
import { scheduleAIPipeline } from './ai-flow';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Time to wait for additional messages before flushing. */
const BUFFER_WINDOW_MS = 45_000; // 45 seconds

/** Maximum messages per buffer before force-flush (prevents memory bloat). */
const MAX_BUFFER_SIZE = 50;

/** Safety: maximum age of a buffer before force-flush (prevents stuck buffers). */
const MAX_BUFFER_AGE_MS = 120_000; // 2 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

interface BufferEntry {
	userId: string;
	workspaceId: string;
	contactId: string;
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	workspaceSalt?: string;
	commitmentSensitivity?: CommitmentSensitivity;
	sourceAccountId?: string;
	messages: PipelineMessage[];
	timer: ReturnType<typeof setTimeout>;
	createdAt: number;
}

// ─── Buffer state ─────────────────────────────────────────────────────────────

/**
 * In-memory buffer keyed by `${contactId}:${workspaceId}`.
 *
 * Why in-memory and not Redis?
 * - Buffers live for 45-120 seconds max — Redis round-trip overhead not justified
 * - Worker runs on a single Fly.io machine — no cross-instance coordination needed
 * - If worker restarts, buffered messages are re-synced on next Telegram poll
 *   (messages are NOT lost — they still exist in Telegram and will be picked up
 *   by the next sync cycle)
 *
 * SEC-006: Messages in the buffer are still encrypted (content field is ciphertext).
 * The buffer passes the keyEnvelope through to the pipeline — decryption happens
 * inside each child worker, not here.
 */
const buffers = new Map<string, BufferEntry>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a message to the buffer for a (contactId, workspaceId) pair.
 * If no buffer exists, creates one with a 45-second flush timer.
 * If the buffer hits MAX_BUFFER_SIZE, flushes immediately.
 *
 * This replaces direct calls to `scheduleAIPipeline()` in the sync worker.
 */
export function bufferMessage(
	userId: string,
	contactId: string,
	workspaceId: string,
	messages: PipelineMessage[],
	keyEnvelope?: BufferEntry['keyEnvelope'],
	workspaceSalt?: string,
	commitmentSensitivity?: CommitmentSensitivity,
	sourceAccountId?: string,
): void {
	const key = `${contactId}:${workspaceId}`;
	const existing = buffers.get(key);

	if (existing) {
		// Append to existing buffer, reset the debounce timer
		existing.messages.push(...messages);
		existing.keyEnvelope = keyEnvelope ?? existing.keyEnvelope;
		existing.workspaceSalt = workspaceSalt ?? existing.workspaceSalt;
		existing.commitmentSensitivity = commitmentSensitivity ?? existing.commitmentSensitivity;
		existing.sourceAccountId = sourceAccountId ?? existing.sourceAccountId;

		clearTimeout(existing.timer);

		// Force-flush if buffer is full or too old
		if (
			existing.messages.length >= MAX_BUFFER_SIZE ||
			Date.now() - existing.createdAt >= MAX_BUFFER_AGE_MS
		) {
			flushBuffer(key);
			return;
		}

		// Reset debounce timer
		existing.timer = setTimeout(() => flushBuffer(key), BUFFER_WINDOW_MS);
		return;
	}

	// Create new buffer entry
	const entry: BufferEntry = {
		userId,
		workspaceId,
		contactId,
		keyEnvelope,
		workspaceSalt,
		commitmentSensitivity,
		sourceAccountId,
		messages: [...messages],
		timer: setTimeout(() => flushBuffer(key), BUFFER_WINDOW_MS),
		createdAt: Date.now(),
	};

	buffers.set(key, entry);

	// Force-flush if initial batch already meets size threshold
	if (entry.messages.length >= MAX_BUFFER_SIZE) {
		clearTimeout(entry.timer);
		flushBuffer(key);
	}
}

/**
 * Flush a single buffer entry: schedule the AI pipeline with all
 * accumulated messages, then delete the buffer.
 */
async function flushBuffer(key: string): Promise<void> {
	const entry = buffers.get(key);
	if (!entry) return;

	// Clear timer and remove from map BEFORE async work (prevents double-flush)
	clearTimeout(entry.timer);
	buffers.delete(key);

	try {
		await scheduleAIPipeline(
			entry.userId,
			entry.contactId,
			entry.workspaceId,
			entry.keyEnvelope,
			entry.messages,
			entry.workspaceSalt,
			entry.commitmentSensitivity,
			entry.sourceAccountId,
		);
		console.log(
			`[message-buffer] Flushed ${entry.messages.length} messages for contact=${entry.contactId.slice(0, 8)}`,
		);
	} catch (err) {
		console.error(
			`[message-buffer] Failed to flush buffer for contact=${entry.contactId.slice(0, 8)}:`,
			redactSensitive(err),
		);
		// Messages are NOT lost — they exist in Telegram and will be re-synced
	}
}

/**
 * Flush ALL pending buffers. Called during graceful shutdown to ensure
 * no buffered messages are silently dropped on deploy.
 */
export async function flushAllBuffers(): Promise<void> {
	const keys = [...buffers.keys()];
	if (keys.length === 0) return;

	console.log(`[message-buffer] Flushing ${keys.length} pending buffers (shutdown)...`);

	await Promise.allSettled(keys.map((key) => flushBuffer(key)));

	console.log('[message-buffer] All buffers flushed.');
}

/**
 * Get current buffer stats (for /metrics endpoint).
 */
export function getBufferStats(): { activeBuffers: number; totalMessages: number } {
	let totalMessages = 0;
	for (const entry of buffers.values()) {
		totalMessages += entry.messages.length;
	}
	return { activeBuffers: buffers.size, totalMessages };
}

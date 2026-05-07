import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveKeys } from '../hkdf';

describe('HKDF Key Derivation', () => {
	const wrk = randomBytes(32);
	const workspaceId = 'ws-test-123';

	it('derives deterministic keys for same inputs', async () => {
		const keys1 = await deriveKeys(wrk, workspaceId, 1);
		const keys2 = await deriveKeys(wrk, workspaceId, 1);
		expect(keys1.dek.equals(keys2.dek)).toBe(true);
		expect(keys1.bik.equals(keys2.bik)).toBe(true);
	});

	it('produces 256-bit (32-byte) DEK and BIK', async () => {
		const keys = await deriveKeys(wrk, workspaceId);
		expect(keys.dek.length).toBe(32);
		expect(keys.bik.length).toBe(32);
	});

	it('DEK and BIK are different from each other', async () => {
		const keys = await deriveKeys(wrk, workspaceId);
		expect(keys.dek.equals(keys.bik)).toBe(false);
	});

	it('different workspace IDs produce different keys', async () => {
		const keys1 = await deriveKeys(wrk, 'workspace-a');
		const keys2 = await deriveKeys(wrk, 'workspace-b');
		expect(keys1.dek.equals(keys2.dek)).toBe(false);
		expect(keys1.bik.equals(keys2.bik)).toBe(false);
	});

	it('different WRKs produce different keys', async () => {
		const wrk2 = randomBytes(32);
		const keys1 = await deriveKeys(wrk, workspaceId);
		const keys2 = await deriveKeys(wrk2, workspaceId);
		expect(keys1.dek.equals(keys2.dek)).toBe(false);
	});

	it('different versions produce different keys', async () => {
		const keys1 = await deriveKeys(wrk, workspaceId, 1);
		const keys2 = await deriveKeys(wrk, workspaceId, 2);
		expect(keys1.dek.equals(keys2.dek)).toBe(false);
	});

	// ── TSK (Telegram Session Key) ─────────────────────────────────────────────

	it('derives a 32-byte TSK', async () => {
		const keys = await deriveKeys(wrk, workspaceId);
		expect(keys.tsk).toBeInstanceOf(Buffer);
		expect(keys.tsk.length).toBe(32);
	});

	it('TSK is different from DEK and BIK (key separation)', async () => {
		const keys = await deriveKeys(wrk, workspaceId);
		expect(keys.tsk.equals(keys.dek)).toBe(false);
		expect(keys.tsk.equals(keys.bik)).toBe(false);
	});

	it('TSK is deterministic (same inputs → same output)', async () => {
		const keys1 = await deriveKeys(wrk, workspaceId, 1);
		const keys2 = await deriveKeys(wrk, workspaceId, 1);
		expect(keys1.tsk.equals(keys2.tsk)).toBe(true);
	});

	it('TSK changes when workspaceId changes (domain separation)', async () => {
		const keys1 = await deriveKeys(wrk, 'workspace-a');
		const keys2 = await deriveKeys(wrk, 'workspace-b');
		expect(keys1.tsk.equals(keys2.tsk)).toBe(false);
	});
});

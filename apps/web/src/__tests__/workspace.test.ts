import { db } from '@repo/db';
import { describe, expect, it, vi } from 'vitest';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';

// Mock Next.js modules (imported by workspace.ts but not used in these tests)
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

// Mock the database module
vi.mock('@repo/db', async () => {
	const actual = await vi.importActual('@repo/db');
	return {
		...actual,
		db: {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([]),
					}),
				}),
			}),
		},
	};
});

describe('getUserWorkspaceId', () => {
	it('returns null when user has no workspace', async () => {
		const result = await getUserWorkspaceId('nonexistent-user');
		expect(result).toBeNull();
	});
});

describe('getWorkspaceEnvelope', () => {
	it('returns null when workspace does not exist', async () => {
		const result = await getWorkspaceEnvelope('nonexistent-workspace');
		expect(result).toBeNull();
	});

	it('returns SealedEnvelope when workspace exists', async () => {
		const mockRow = {
			encryptedWrk: Buffer.from('test-encrypted-wrk').toString('base64'),
			kmsContext: { WorkspaceID: 'ws-123' },
			wrkVersion: 1,
		};

		const selectMock = vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([mockRow]),
				}),
			}),
		});
		(db as unknown as { select: typeof selectMock }).select = selectMock;

		const envelope = await getWorkspaceEnvelope('ws-123');
		expect(envelope).not.toBeNull();
		expect(envelope).toHaveProperty('encryptedWrk');
		expect(envelope).toHaveProperty('kmsContext');
		expect(envelope).toHaveProperty('wrkVersion');
		expect(envelope?.kmsContext).toEqual({ WorkspaceID: 'ws-123' });
		expect(envelope?.wrkVersion).toBe(1);
		expect(Buffer.isBuffer(envelope?.encryptedWrk)).toBe(true);
	});
});

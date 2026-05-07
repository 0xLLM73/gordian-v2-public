import { hkdf } from 'node:crypto';
import { promisify } from 'node:util';
import type { DerivedKeys } from './types';

const hkdfAsync = promisify(hkdf);

/**
 * HKDF info format: CRM_v{version}|workspace|{workspaceId}|{context}
 * Derive unique DEK + BIK per workspace from Workspace Root Key.
 */
export async function deriveKeys(
	wrk: Buffer,
	workspaceId: string,
	version = 1,
): Promise<DerivedKeys> {
	const dekInfo = `CRM_v${version}|workspace|${workspaceId}|dek`;
	const bikInfo = `CRM_v${version}|workspace|${workspaceId}|bik`;
	const tskInfo = `CRM_v${version}|workspace|${workspaceId}|tsk`;

	const [dekBuf, bikBuf, tskBuf] = await Promise.all([
		hkdfAsync('sha256', wrk, '', dekInfo, 32), // 256-bit DEK
		hkdfAsync('sha256', wrk, '', bikInfo, 32), // 256-bit BIK
		hkdfAsync('sha256', wrk, '', tskInfo, 32), // 256-bit TSK
	]);

	return {
		dek: Buffer.from(dekBuf),
		bik: Buffer.from(bikBuf),
		tsk: Buffer.from(tskBuf),
	};
}

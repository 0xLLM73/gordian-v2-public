import type { SealedEnvelope } from '@repo/crypto';
import { getOptionalWorkerInternalSecret } from './runtime-env';

interface RationaleHookParams {
	action: string;
	label: string;
	entityId: string;
	entityType: 'deal' | 'introduction' | 'recommendation' | 'commitment' | 'contact';
	contactId?: string;
	workspaceId: string;
	envelope: SealedEnvelope;
}

/**
 * Fire-and-forget hook to trigger rationale extraction on the worker.
 * SEC-PROV-004: Includes keyEnvelope for worker-side key derivation.
 * SEC-PROV-009: Label must be structural only — NEVER include deal titles or contact names.
 *
 * Call AFTER the main action succeeds. Never awaited — .catch(() => {}) ensures
 * the user action is never slowed down.
 */
export function fireRationaleExtraction(params: RationaleHookParams): void {
	const workerUrl = process.env.WORKER_URL ?? 'http://localhost:3001';
	const internalSecret = getOptionalWorkerInternalSecret();
	if (!internalSecret) return;

	fetch(`${workerUrl}/rationale/extract`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': internalSecret,
		},
		body: JSON.stringify({
			action: params.action,
			label: params.label,
			contactId: params.contactId,
			entityId: params.entityId,
			entityType: params.entityType,
			workspaceId: params.workspaceId,
			keyEnvelope: {
				encryptedWrk: params.envelope.encryptedWrk.toString('base64'),
				kmsContext: params.envelope.kmsContext,
				wrkVersion: params.envelope.wrkVersion,
			},
		}),
	}).catch(() => {}); // Fire-and-forget
}

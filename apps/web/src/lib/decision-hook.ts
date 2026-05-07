import type { SealedEnvelope } from '@repo/crypto';
import { getOptionalWorkerInternalSecret } from './runtime-env';

interface DecisionHookParams {
	userId: string;
	workspaceId: string;
	decisionType: string;
	label: string;
	entityId?: string;
	envelope: SealedEnvelope;
}

/**
 * Fire-and-forget hook to record a decision event on the worker.
 * SEC-PROV-009: Label must be structural only — NEVER include PII (deal titles, contact names).
 *
 * Call AFTER the main action succeeds. Never awaited — .catch(() => {}) ensures
 * the user action is never slowed down.
 */
export function fireDecisionRecording(params: DecisionHookParams): void {
	const workerUrl = process.env.WORKER_URL ?? 'http://localhost:3001';
	const internalSecret = getOptionalWorkerInternalSecret();
	if (!internalSecret) return;

	fetch(`${workerUrl}/decision/record`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': internalSecret,
		},
		body: JSON.stringify({
			userId: params.userId,
			workspaceId: params.workspaceId,
			decisionType: params.decisionType,
			label: params.label,
			entityId: params.entityId,
			keyEnvelope: {
				encryptedWrk: params.envelope.encryptedWrk.toString('base64'),
				kmsContext: params.envelope.kmsContext,
				wrkVersion: params.envelope.wrkVersion,
			},
		}),
	}).catch(() => {}); // Fire-and-forget
}

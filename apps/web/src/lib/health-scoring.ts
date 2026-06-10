import { getOptionalWorkerInternalSecret } from './runtime-env';

interface EnsureHealthScoringOptions {
	force?: boolean;
	reason?: string;
	staleAfterMinutes?: number;
}

export async function ensureHealthScoringFreshness(
	workspaceId: string,
	options: EnsureHealthScoringOptions = {},
): Promise<void> {
	const secret = getOptionalWorkerInternalSecret();
	if (!secret) return;

	const workerUrl = process.env.WORKER_URL ?? 'http://localhost:3001';
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 1500);

	try {
		await fetch(`${workerUrl}/admin/ensure-health`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': secret,
			},
			body: JSON.stringify({
				workspaceId,
				reason: options.reason ?? 'dashboard_open',
				force: options.force === true,
				staleAfterMinutes: options.staleAfterMinutes,
			}),
			signal: controller.signal,
		});
	} catch {
		// Health scores are best-effort on page open; the worker also refreshes on startup/import.
	} finally {
		clearTimeout(timeout);
	}
}

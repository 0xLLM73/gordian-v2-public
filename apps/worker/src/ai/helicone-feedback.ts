/**
 * Helicone Feedback API — POST correction signals to Helicone dashboard.
 * Uses the bandit traceId as the Helicone Request ID for direct lookup.
 *
 * Non-fatal: silently no-ops if HELICONE_API_KEY is not set,
 * and catches/logs errors without throwing.
 */
import { getHeliconeApiKey } from '@repo/shared';

export async function sendHeliconeFeedback(
	heliconeRequestId: string,
	rating: boolean,
	comment?: string,
): Promise<void> {
	const apiKey = getHeliconeApiKey();
	if (!apiKey) return;

	try {
		const response = await fetch('https://api.helicone.ai/v1/feedback', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				'helicone-id': heliconeRequestId,
				rating,
				...(comment ? { comment } : {}),
			}),
		});

		if (!response.ok) {
			console.error(`[helicone-feedback] POST failed: ${response.status} ${response.statusText}`);
		} else {
			console.log(`[helicone-feedback] Feedback sent for ${heliconeRequestId}: rating=${rating}`);
		}
	} catch (err) {
		console.error('[helicone-feedback] Error:', (err as Error).message);
	}
}

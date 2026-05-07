import type { SealedEnvelope } from '@repo/crypto';
import { getCalibrationForAI } from '@repo/db';

/**
 * Build the calibration modifier string for injection into AI system kernels.
 * Returns empty string if no completed calibration exists (graceful no-op).
 */
export async function buildCalibrationKernelModifier(
	userId: string,
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<string> {
	const ctx = await getCalibrationForAI(userId, workspaceId, envelope);
	if (!ctx) return '';

	return [
		'',
		'## User Calibration (Layer 1 Modifier)',
		ctx.summary,
		'',
		'Adapt your tone, depth, emphasis, and content selection to match this profile.',
		`Communication style: ${ctx.dimensions.communicationStyle}. Detail level: ${ctx.dimensions.detailPreference}.`,
		'',
	].join('\n');
}

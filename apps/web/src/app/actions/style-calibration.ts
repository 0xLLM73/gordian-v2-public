'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { getVoiceProfile, isFeatureEnabled, markCalibrationComplete } from '@repo/db';
import { z } from 'zod';

export const getCalibrationSamplesAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		// Check feature flag — skip calibration if disabled
		const flagEnabled = await isFeatureEnabled('voice_profile_calibration', ctx.workspaceId);
		if (!flagEnabled) {
			return { alreadyCalibrated: true as const, samples: [] };
		}

		const profile = await getVoiceProfile(ctx.session.user.id, ctx.workspaceId);
		if (profile?.calibrationComplete) {
			return { alreadyCalibrated: true as const, samples: [] };
		}

		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');

		const response = await fetch(`${workerUrl}/draft/calibrate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({ userId: ctx.session.user.id }),
		});

		if (!response.ok) throw new Error('Calibration sample generation failed');
		const { samples } = (await response.json()) as {
			samples: Array<{
				text: string;
				armType: 'casual_nudge' | 'professional_value' | 'direct_ask' | 'soft_memory';
			}>;
		};

		track(ctx.workspaceId, ctx.session.user.id, 'onboarding.calibration_samples_loaded', {
			sample_count: samples.length,
		});

		return { alreadyCalibrated: false as const, samples };
	});

// [SEC-FIX CRIT-2] armType enum allowlist + editedText max length
export const submitCalibrationFeedbackAction = workspaceAction
	.schema(
		z.object({
			reactions: z
				.array(
					z.object({
						armType: z.enum(['casual_nudge', 'professional_value', 'direct_ask', 'soft_memory']),
						action: z.enum(['approve', 'reject', 'edit']),
						editedText: z.string().max(4000).optional(),
						reason: z.string().max(200).optional(),
					}),
				)
				.max(4),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');

		const response = await fetch(`${workerUrl}/draft/calibrate-feedback`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				reactions: parsedInput.reactions,
			}),
		});

		if (!response.ok) throw new Error('Calibration feedback processing failed');

		await markCalibrationComplete(ctx.session.user.id, ctx.workspaceId);

		// Track calibration analytics
		if (parsedInput.reactions.length > 0) {
			track(ctx.workspaceId, ctx.session.user.id, 'onboarding.calibration_submitted', {
				reaction_count: parsedInput.reactions.length,
			});
			for (const r of parsedInput.reactions) {
				track(ctx.workspaceId, ctx.session.user.id, 'onboarding.calibration_sample_rated', {
					arm_type: r.armType,
					action: r.action,
					reason: r.reason,
				});
			}
		} else {
			track(ctx.workspaceId, ctx.session.user.id, 'onboarding.calibration_skipped');
		}

		// [SEC-FIX MED-3] Audit trail for calibration reactions (fire-and-forget, no PII)
		const { appendAuditLog } = await import('@repo/db');
		appendAuditLog({
			workspaceId: ctx.workspaceId,
			actorType: 'user',
			actorId: ctx.session.user.id,
			action: 'update',
			resourceType: 'preference',
			resourceId: ctx.workspaceId,
			metadata: {
				reactionCount: parsedInput.reactions.length,
				actions: parsedInput.reactions.map((r) => r.action),
				armTypes: parsedInput.reactions.map((r) => r.armType),
			},
		});

		return { calibrated: true };
	});

import {
	and,
	appendAuditLog,
	db,
	eq,
	getContactStyleOverride,
	getVoiceProfile,
	isFeatureEnabled,
	upsertVoiceProfile,
	workspaceMembers,
} from '@repo/db';
import { Hono } from 'hono';
import { generateDraft, generateDraftWithBandit } from '../ai/draft-generation';
import { extractStyleFeatures } from '../ai/style-analysis';
import { buildVoiceModifier } from '../ai/voice-modifier';
import { validateInternalSecret } from '../middleware/auth';

const draftRoutes = new Hono();

draftRoutes.post('/generate', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const { contactSummary, recentMessages, userId, workspaceId, contactId } = await c.req.json<{
		contactSummary: string;
		recentMessages: string;
		userId: string;
		workspaceId?: string;
		contactId?: string;
	}>();

	if (!contactSummary || !userId) {
		return c.json({ error: 'contactSummary and userId are required' }, 400);
	}

	try {
		// Build voice modifier if profile data available
		let voiceModifier = '';
		let styleProfileVersion: number | null = null;

		if (workspaceId && contactId) {
			const injectionEnabled = await isFeatureEnabled('voice_profile_injection', workspaceId);
			if (injectionEnabled) {
				// [SEC-FIX LOW-2] Timeout after 2s — draft generation doesn't block on slow DB
				const PROFILE_TIMEOUT = 2000;
				const timeoutPromise = new Promise<null>((resolve) =>
					setTimeout(() => resolve(null), PROFILE_TIMEOUT),
				);

				const [profile, override] = await Promise.all([
					Promise.race([getVoiceProfile(userId, workspaceId), timeoutPromise]),
					Promise.race([getContactStyleOverride(workspaceId, contactId), timeoutPromise]),
				]);
				const result = buildVoiceModifier(profile, override);
				voiceModifier = result.modifier;
				styleProfileVersion = result.profileVersion;
			}
		}

		const draftResult = await generateDraftWithBandit(
			contactSummary,
			recentMessages || '',
			userId,
			voiceModifier || undefined,
		);

		return c.json({
			...draftResult,
			styleProfileVersion,
		});
	} catch (err) {
		console.error('[draft] Error:', err instanceof Error ? err.message : err);
		return c.json({ error: 'Draft generation failed' }, 500);
	}
});

// POST /calibrate — generate 3 sample messages for style calibration
draftRoutes.post('/calibrate', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const { userId } = await c.req.json<{ userId: string }>();
	if (!userId) return c.json({ error: 'userId is required' }, 400);

	const sampleScenario =
		'Hey! Just wanted to check in and see how things are going with the project. Let me know if you need anything from my end.';

	const arms = ['casual_nudge', 'professional_value', 'direct_ask'] as const;
	const samples = await Promise.all(
		arms.map(async (arm) => {
			const text = await generateDraft(sampleScenario, '', arm);
			return { text, armType: arm };
		}),
	);

	return c.json({ samples });
});

// POST /calibrate-feedback — process user reactions to calibration samples
draftRoutes.post('/calibrate-feedback', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		userId: string;
		workspaceId: string;
		reactions: Array<{
			armType: string;
			action: 'approve' | 'reject' | 'edit';
			editedText?: string;
			reason?: string;
		}>;
	}>();

	const { userId, workspaceId, reactions } = body;

	if (!userId || !workspaceId || !reactions) {
		return c.json({ error: 'userId, workspaceId, and reactions are required' }, 400);
	}

	// [SEC-FIX HIGH-3] Verify user is member of workspace
	const membership = await db
		.select({ id: workspaceMembers.id })
		.from(workspaceMembers)
		.where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
		.limit(1);
	if (membership.length === 0) {
		return c.json({ error: 'User not in workspace' }, 403);
	}

	// [SEC-FIX CRIT-2] Validate reactions: armType must be allowlisted, editedText max 4000 chars
	const VALID_ARMS = new Set(['casual_nudge', 'professional_value', 'direct_ask', 'soft_memory']);
	const validReactions = reactions.filter((r) => {
		if (!VALID_ARMS.has(r.armType)) return false;
		if (r.editedText && r.editedText.length > 4000) return false;
		return true;
	});

	// [SEC-FIX CRIT-2] Only extract features from edited text, NEVER from armType string
	const textsForExtraction = validReactions
		.filter((r) => r.action === 'edit' && r.editedText)
		.map((r) => ({ content: r.editedText as string }));

	if (textsForExtraction.length > 0) {
		const features = extractStyleFeatures(textsForExtraction);
		await upsertVoiceProfile(userId, workspaceId, features);
	}

	// SEC-VP-400: persist each calibration reaction via audit log (fire-and-forget)
	for (const reaction of validReactions) {
		appendAuditLog({
			workspaceId,
			actorType: 'user',
			actorId: userId,
			action: 'update',
			resourceType: 'preference',
			metadata: {
				calibration: true,
				armType: reaction.armType,
				reactionAction: reaction.action,
			},
		});
	}

	// markCalibrationComplete is called by the web action after checking response.ok
	return c.json({ calibrated: true });
});

export { draftRoutes };

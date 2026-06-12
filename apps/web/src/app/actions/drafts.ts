'use server';

import {
	deriveKeys,
	generatePersonPseudonym,
	maskEntities,
	prefilterEntities,
	unwrapWrk,
} from '@repo/crypto';
import {
	createDraftLog,
	getContact,
	getContactsByIds,
	getLatestSummary,
	getPendingDrafts,
	getRecentMessages,
	markDraftDiscarded,
	markDraftSent,
} from '@repo/db';
import { z } from 'zod';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';

export const generateDraftAction = workspaceAction
	.schema(z.object({ contactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');

		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

		// Fetch contact summary + recent messages for context
		const [contact, summary, messages] = await Promise.all([
			getContact(ctx.workspaceId, parsedInput.contactId, ctx.envelope),
			getLatestSummary(ctx.workspaceId, parsedInput.contactId, ctx.envelope),
			getRecentMessages(ctx.workspaceId, parsedInput.contactId, thirtyDaysAgo, ctx.envelope),
		]);

		if (!contact) throw new Error('Contact not found');

		const wrk = await unwrapWrk(ctx.envelope);
		const keys = await deriveKeys(wrk, ctx.workspaceId, ctx.envelope.wrkVersion);
		const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
		const contactPseudonym = generatePersonPseudonym(parsedInput.contactId, keys.bik);
		const contactAliases = [
			contactName,
			contact.firstName,
			contact.lastName,
			(contact as Record<string, unknown>).username,
		].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
		const maskDraftContext = (value: string) =>
			replaceKnownContactAliases(
				maskEntities(value, keys.bik, prefilterEntities(value)).maskedText,
				contactAliases,
				contactPseudonym,
			);

		const summaryText = summary
			? ((summary as Record<string, unknown>).summary as string) || ''
			: '';
		const contactSummary = `Contact: ${contactPseudonym}\n${maskDraftContext(summaryText)}`;
		const recentText = messages
			.map((m: Record<string, unknown>) => m.content as string)
			.filter(Boolean)
			.join('\n')
			.slice(0, 2000);
		const maskedRecentText = maskDraftContext(recentText);

		// Call worker to generate draft
		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');
		const response = await fetch(`${workerUrl}/draft/generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				contactSummary,
				recentMessages: maskedRecentText,
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				contactId: parsedInput.contactId,
				contextMasked: true,
			}),
		});

		if (!response.ok) throw new Error('Draft generation failed');

		const workerResponse = (await response.json()) as {
			text: string;
			armType: string;
			traceId: string;
			styleProfileVersion?: unknown;
		};
		const { text, armType, traceId } = workerResponse;

		// [SEC-FIX LOW-3] Validate styleProfileVersion is a number
		const styleProfileVersion =
			typeof workerResponse.styleProfileVersion === 'number'
				? workerResponse.styleProfileVersion
				: null;

		// Store in draft_logs
		const draft = await createDraftLog(
			ctx.workspaceId,
			parsedInput.contactId,
			armType as 'casual_nudge' | 'professional_value' | 'direct_ask' | 'soft_memory',
			text,
			ctx.envelope,
			styleProfileVersion,
		);

		track(ctx.workspaceId, ctx.session.user.id, 'generate_draft', {
			contactId: parsedInput.contactId,
		});
		return { draftId: draft?.id, text, armType, traceId };
	});

export const sendDraftAction = workspaceAction
	.schema(
		z.object({
			draftId: z.string().uuid(),
			editedText: z.string().min(1).max(4000),
			originalText: z.string(),
			traceId: z.string(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');

		// Compute Levenshtein edit distance
		const editDistance = levenshtein(parsedInput.originalText, parsedInput.editedText);
		const maxLen = Math.max(parsedInput.originalText.length, parsedInput.editedText.length);
		const normalizedReward = maxLen > 0 ? 1 - editDistance / maxLen : 1;

		await markDraftSent(
			ctx.workspaceId,
			parsedInput.draftId,
			parsedInput.editedText,
			editDistance,
			ctx.envelope,
		);

		// Send bandit reward
		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');
		await fetch(`${workerUrl}/feedback/reward`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				traceId: parsedInput.traceId,
				rewardScore: Math.max(0.3, normalizedReward),
			}),
		}).catch(() => {});

		return { sent: true };
	});

export const discardDraftAction = workspaceAction
	.schema(
		z.object({
			draftId: z.string().uuid(),
			traceId: z.string(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await markDraftDiscarded(ctx.workspaceId, parsedInput.draftId);

		// Low reward for discarded drafts
		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');
		await fetch(`${workerUrl}/feedback/reward`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				traceId: parsedInput.traceId,
				rewardScore: 0.2,
			}),
		}).catch(() => {});

		return { discarded: true };
	});

export const getPendingDraftsAction = workspaceAction
	.schema(z.object({ limit: z.number().int().positive().optional() }))
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const drafts = await getPendingDrafts(ctx.workspaceId, ctx.envelope, {
			limit: parsedInput.limit,
		});

		// Resolve contact names for display
		const contactIds = [...new Set(drafts.map((d) => d.contactId))];
		const contacts =
			contactIds.length > 0
				? await getContactsByIds(ctx.workspaceId, contactIds, ctx.envelope)
				: [];
		const contactMap = new Map(contacts.map((c) => [c.id, c]));

		return drafts.map((d) => {
			const contact = contactMap.get(d.contactId);
			const contactName = contact
				? [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown'
				: 'Unknown';
			return {
				id: d.id,
				contactId: d.contactId,
				contactName,
				armType: d.armType,
				preview: (d.generatedText as string).slice(0, 120),
				createdAt: d.createdAt,
			};
		});
	});

function replaceKnownContactAliases(text: string, aliases: string[], replacement: string): string {
	return aliases.reduce((current, alias) => {
		const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!escaped) return current;
		return current.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), replacement);
	}, text);
}

// Simple Levenshtein distance
function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1]
					: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
		}
	}
	return dp[m][n];
}

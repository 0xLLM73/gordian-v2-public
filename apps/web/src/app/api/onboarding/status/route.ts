import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { isStoredSessionUnwrapOutsideImportsAllowed } from '@/lib/telegram-session-policy';
import { getUserWorkspaceId } from '@/lib/workspace';
import {
	and,
	contacts,
	db,
	eq,
	getUserTelegramAccountIds,
	inArray,
	messages,
	sql,
	userCalibrations,
} from '@repo/db';
import { TELEGRAM_CONSENT_VERSION } from '@repo/shared';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { allowed, retryAfterMs } = checkRateLimit(
		`${session.user.id}:onboarding-status`,
		10,
		60_000,
	);
	if (!allowed) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
		});
	}

	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) {
		return NextResponse.json({
			workspaceId: null,
			contacts: 0,
			messages: 0,
			synced: false,
			hasCurrentTelegramConsent: false,
			telegramImportOnlyMode: !isStoredSessionUnwrapOutsideImportsAllowed(),
			telegramAccounts: [],
		});
	}

	const [consentRow] = await db
		.select({
			consentTelegramAccess: userCalibrations.consentTelegramAccess,
			consentVersion: userCalibrations.consentVersion,
		})
		.from(userCalibrations)
		.where(
			and(
				eq(userCalibrations.userId, session.user.id),
				eq(userCalibrations.workspaceId, workspaceId),
			),
		)
		.limit(1);
	const hasCurrentTelegramConsent = Boolean(
		consentRow?.consentTelegramAccess && consentRow.consentVersion >= TELEGRAM_CONSENT_VERSION,
	);

	const telegramAccountIds = await getUserTelegramAccountIds(session.user.id);
	if (telegramAccountIds.length === 0) {
		return NextResponse.json({
			workspaceId,
			contacts: 0,
			messages: 0,
			synced: false,
			hasCurrentTelegramConsent,
			telegramImportOnlyMode: !isStoredSessionUnwrapOutsideImportsAllowed(),
			telegramAccounts: [],
		});
	}

	const [contactResult, messageResult] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(contacts)
			.where(
				and(
					eq(contacts.workspaceId, workspaceId),
					inArray(contacts.sourceAccountId, telegramAccountIds),
				),
			),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(messages)
			.where(eq(messages.workspaceId, workspaceId)),
	]);

	const contactCount = contactResult[0]?.count ?? 0;
	const messageCount = messageResult[0]?.count ?? 0;

	// Consider synced once we have contacts AND messages (both phases complete).
	// Using messageCount > 0 avoids marking "complete" while only contacts phase is done.
	const synced = contactCount > 0 && messageCount > 0;

	return NextResponse.json({
		workspaceId,
		contacts: contactCount,
		messages: messageCount,
		synced,
		hasCurrentTelegramConsent,
		telegramImportOnlyMode: !isStoredSessionUnwrapOutsideImportsAllowed(),
		telegramAccounts: telegramAccountIds.map((_, index) => ({
			key: String(index),
			label: `Telegram account ${index + 1}`,
		})),
	});
}

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
import {
	canRunLocalEmbeddingGeneration,
	isAiAnalysisAvailable,
	isVendorAiEgressEnabled,
	TELEGRAM_CONSENT_VERSION,
} from '@repo/shared';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { isStoredSessionUnwrapOutsideImportsAllowed } from '@/lib/telegram-session-policy';
import { getUserWorkspaceId } from '@/lib/workspace';

type SafetyTone = 'ok' | 'neutral' | 'warn';

function safetyItem(label: string, status: string, detail: string, tone: SafetyTone = 'neutral') {
	return { label, status, detail, tone };
}

function onboardingSafetySummary() {
	const telegramSessionKeyProvider =
		process.env.TELEGRAM_SESSION_KEY_PROVIDER?.trim() || 'dev-insecure';
	const workspaceKeyProvider = process.env.WORKSPACE_KEY_PROVIDER?.trim() || 'dev-insecure';
	const requiresUserPresence =
		process.env.TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE?.trim() === 'true';
	const userPresenceMode = process.env.TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE?.trim() || 'compat';
	const hasKeychainHelper = Boolean(process.env.GORDIAN_KEYCHAIN_HELPER_PATH?.trim());
	const importOnlyMode = !isStoredSessionUnwrapOutsideImportsAllowed();
	const idleMinutes = process.env.TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES?.trim() || '30';
	const aiAvailable = isAiAnalysisAvailable(process.env);
	const localAiAvailable = canRunLocalEmbeddingGeneration(process.env);
	const vendorAiAvailable = isVendorAiEgressEnabled(process.env);
	const aiDescription = !aiAvailable
		? 'AI analysis is not configured, so imported messages will not be sent to AI providers.'
		: localAiAvailable && !vendorAiAvailable
			? 'AI analysis can use configured local models without vendor AI egress.'
			: localAiAvailable && vendorAiAvailable
				? 'AI analysis may use configured local models or cloud AI providers, depending on the active feature.'
				: 'AI analysis may summarize, embed, or classify eligible imported messages with configured cloud AI providers.';

	const telegramUnlock =
		telegramSessionKeyProvider === 'os-keychain'
			? requiresUserPresence
				? userPresenceMode === 'strict' && hasKeychainHelper
					? safetyItem(
							'Telegram import unlock',
							'Strict Touch ID requested',
							'Each import run reads the saved MTProto session key through macOS Keychain user presence.',
							'ok',
						)
					: safetyItem(
							'Telegram import unlock',
							userPresenceMode === 'strict' ? 'Strict helper missing' : 'Keychain prompt requested',
							'The session key stays in Keychain, but strict Touch ID readiness should be verified with pnpm telegram:doctor.',
							'warn',
						)
				: safetyItem(
						'Telegram import unlock',
						'When Mac unlocked',
						'The MTProto session unwrap key stays in macOS Keychain and is available while the login keychain is unlocked.',
						'ok',
					)
			: telegramSessionKeyProvider === 'aws-kms'
				? safetyItem(
						'Telegram import unlock',
						'AWS KMS',
						'Telegram session unwrap uses a configured KMS key instead of local Keychain custody.',
						'neutral',
					)
				: safetyItem(
						'Telegram import unlock',
						'Local demo key',
						'This provider is for synthetic demos only and must not be used for personal Telegram accounts.',
						'warn',
					);

	const workspaceUnlock =
		workspaceKeyProvider === 'os-keychain'
			? safetyItem(
					'Workspace data unlock',
					'macOS Keychain',
					'Workspace root keys for encrypted local CRM data are stored in macOS Keychain.',
					'ok',
				)
			: workspaceKeyProvider === 'aws-kms'
				? safetyItem(
						'Workspace data unlock',
						'AWS KMS',
						'Workspace root keys are protected by configured KMS custody.',
						'neutral',
					)
				: safetyItem(
						'Workspace data unlock',
						'Local demo key',
						'Local demo keys are acceptable for synthetic seeded data, not personal account imports.',
						'warn',
					);

	return {
		aiAvailable,
		aiDescription,
		items: [
			telegramUnlock,
			workspaceUnlock,
			safetyItem(
				'Session unlock scope',
				importOnlyMode ? 'History import only' : 'Legacy jobs allowed',
				importOnlyMode
					? 'Stored Telegram sessions can be opened only by the explicit history import flow.'
					: 'Legacy sync jobs may also open the stored Telegram session.',
				importOnlyMode ? 'ok' : 'warn',
			),
			safetyItem(
				'MTProto memory window',
				`${idleMinutes} min`,
				'The worker disconnects the Telegram client at terminal import states and evicts idle helper threads after this window.',
				'neutral',
			),
			safetyItem(
				'Local disk protection',
				'Verify with doctor',
				'Run pnpm telegram:doctor to verify FileVault, local Postgres, local Redis, and Keychain readiness on this Mac.',
				'neutral',
			),
		],
	};
}

const baseOnboardingStatus = () => ({
	telegramImportOnlyMode: !isStoredSessionUnwrapOutsideImportsAllowed(),
	runtimeSafety: onboardingSafetySummary(),
});

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
			...baseOnboardingStatus(),
			workspaceId: null,
			contacts: 0,
			messages: 0,
			synced: false,
			hasCurrentTelegramConsent: false,
			consent: null,
			telegramAccounts: [],
		});
	}

	const [consentRow] = await db
		.select({
			consentDataProcessing: userCalibrations.consentDataProcessing,
			consentAiAnalysis: userCalibrations.consentAiAnalysis,
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
			...baseOnboardingStatus(),
			workspaceId,
			contacts: 0,
			messages: 0,
			synced: false,
			hasCurrentTelegramConsent,
			consent: consentRow
				? {
						dataProcessing: consentRow.consentDataProcessing,
						aiAnalysis: consentRow.consentAiAnalysis,
						telegramAccess: consentRow.consentTelegramAccess,
						version: consentRow.consentVersion,
					}
				: null,
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
		...baseOnboardingStatus(),
		workspaceId,
		contacts: contactCount,
		messages: messageCount,
		synced,
		hasCurrentTelegramConsent,
		consent: consentRow
			? {
					dataProcessing: consentRow.consentDataProcessing,
					aiAnalysis: consentRow.consentAiAnalysis,
					telegramAccess: consentRow.consentTelegramAccess,
					version: consentRow.consentVersion,
				}
			: null,
		telegramAccounts: telegramAccountIds.map((_, index) => ({
			key: String(index),
			label: `Telegram account ${index + 1}`,
		})),
	});
}

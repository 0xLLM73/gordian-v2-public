import { PreferencesForm } from '@/components/preferences-form';
import { AiAnalysisConsent } from '@/components/settings/ai-analysis-consent';
import { BriefScheduleEditor } from '@/components/settings/brief-schedule-editor';
import { DeleteAccount } from '@/components/settings/delete-account';
import { FeatureFlagsSection } from '@/components/settings/feature-flags';
import { GhostingPreferences } from '@/components/settings/ghosting-preferences';
import {
	ConnectionKeywordsEditor,
	IntroKeywordsEditor,
} from '@/components/settings/intro-keywords-editor';
import { InviteManager } from '@/components/settings/invite-manager';
import { NotificationPreferences } from '@/components/settings/notification-preferences';
import {
	TelegramConnection,
	type TelegramSafetyItem,
} from '@/components/settings/telegram-connection';
import { isRuntimeEnvEnabled } from '@/lib/runtime-env';
import { isStoredSessionUnwrapOutsideImportsAllowed } from '@/lib/telegram-session-policy';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { isWorkspaceOwner } from '@/lib/workspace-authz';
import { accounts, and, db, eq, getCalibration, getPreferences, isFeatureEnabled } from '@repo/db';
import { isAiAnalysisAvailable } from '@repo/shared';
import Link from 'next/link';
import { Suspense } from 'react';

function telegramSessionUnlockScopeStatus(): TelegramSafetyItem {
	const legacyUnwrapAllowed = isStoredSessionUnwrapOutsideImportsAllowed();

	return {
		label: 'Session unlock scope',
		status: legacyUnwrapAllowed ? 'Legacy jobs allowed' : 'History import only',
		tone: legacyUnwrapAllowed ? 'warn' : 'ok',
	};
}

function telegramMtprotoMemoryWindowStatus(): TelegramSafetyItem {
	const raw = process.env.TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES?.trim() || '30';
	const idleMinutes = Number.parseInt(raw, 10);

	if (!Number.isInteger(idleMinutes) || idleMinutes < 1 || idleMinutes > 1440) {
		return { label: 'MTProto memory window', status: 'Invalid', tone: 'warn' };
	}

	return {
		label: 'MTProto memory window',
		status: `${idleMinutes} min`,
		tone: idleMinutes <= 5 ? 'ok' : idleMinutes <= 30 ? 'neutral' : 'warn',
	};
}

function telegramMtprotoInteractionStatus(): TelegramSafetyItem {
	const raw = process.env.TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK?.trim() || 'false';
	if (raw === 'true') {
		return { label: 'MTProto session reuse', status: 'Per read', tone: 'ok' };
	}
	if (raw === 'false') {
		return { label: 'MTProto session reuse', status: 'Per import run', tone: 'ok' };
	}
	return { label: 'MTProto session reuse', status: 'Invalid', tone: 'warn' };
}

function telegramKeychainAccessStatus(provider: string): TelegramSafetyItem {
	if (provider === 'os-keychain') {
		const requiresUserPresence =
			process.env.TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE?.trim() === 'true';
		const userPresenceMode = process.env.TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE?.trim() || 'compat';
		const hasStrictHelper = Boolean(process.env.GORDIAN_KEYCHAIN_HELPER_PATH?.trim());
		const strictRequested = userPresenceMode === 'strict';

		return {
			label: 'Telegram import unlock',
			status: requiresUserPresence
				? strictRequested
					? hasStrictHelper
						? 'Strict Touch ID requested'
						: 'Strict helper missing'
					: 'Keychain prompt requested'
				: 'When Mac unlocked',
			tone:
				requiresUserPresence && (!strictRequested || (strictRequested && !hasStrictHelper))
					? 'warn'
					: 'ok',
		};
	}

	if (provider === 'aws-kms') {
		return { label: 'Telegram import unlock', status: 'AWS KMS', tone: 'neutral' };
	}

	return { label: 'Telegram import unlock', status: 'Not protected', tone: 'warn' };
}

function workspaceKeychainAccessStatus(provider: string): TelegramSafetyItem {
	if (provider === 'os-keychain') {
		return { label: 'Workspace data unlock', status: 'When Mac unlocked', tone: 'ok' };
	}
	if (provider === 'aws-kms') {
		return { label: 'Workspace data unlock', status: 'AWS KMS', tone: 'neutral' };
	}
	return { label: 'Workspace data unlock', status: 'Local demo key', tone: 'warn' };
}

export default async function SettingsPage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	const telegramAccount = await db
		.select({ accountId: accounts.accountId })
		.from(accounts)
		.where(and(eq(accounts.userId, session.user.id), eq(accounts.providerId, 'telegram')))
		.limit(1);
	const isConnected = telegramAccount.length > 0;
	const telegramLinkingEnabled =
		isRuntimeEnvEnabled('TELEGRAM_MTPROTO_ENABLED') &&
		isRuntimeEnvEnabled('NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED');
	const telegramBotEnabled = isRuntimeEnvEnabled('TELEGRAM_BOT_ENABLED');
	const telegramSendEnabled = isRuntimeEnvEnabled('TELEGRAM_SEND_ENABLED');
	const telegramFullBackfillEnabled = isRuntimeEnvEnabled('TELEGRAM_FULL_BACKFILL_ENABLED');
	const telegramPeriodicSyncEnabled = isRuntimeEnvEnabled('TELEGRAM_PERIODIC_SYNC_ENABLED');
	const telegramSessionKeyProvider =
		process.env.TELEGRAM_SESSION_KEY_PROVIDER?.trim() || 'dev-insecure';
	const workspaceKeyProvider = process.env.WORKSPACE_KEY_PROVIDER?.trim() || 'dev-insecure';
	const keyProviderStatus = (provider: string): TelegramSafetyItem =>
		provider === 'os-keychain' || provider === 'aws-kms'
			? { label: 'Session key custody', status: provider, tone: 'ok' }
			: { label: 'Session key custody', status: provider, tone: 'warn' };
	const workspaceProviderStatus = (provider: string): TelegramSafetyItem =>
		provider === 'os-keychain' || provider === 'aws-kms'
			? { label: 'Workspace keys', status: provider, tone: 'ok' }
			: { label: 'Workspace keys', status: provider, tone: 'warn' };
	const telegramSafetyItems: TelegramSafetyItem[] = [
		{
			label: 'Linking UI',
			status: telegramLinkingEnabled ? 'Available' : 'Disabled',
			tone: telegramLinkingEnabled ? 'neutral' : 'ok',
		},
		{
			label: 'Message sending',
			status: telegramSendEnabled ? 'Enabled' : 'Disabled',
			tone: telegramSendEnabled ? 'warn' : 'ok',
		},
		{
			label: 'Full backfill',
			status: telegramFullBackfillEnabled ? 'Enabled' : 'Disabled',
			tone: telegramFullBackfillEnabled ? 'warn' : 'ok',
		},
		{
			label: 'Periodic sync',
			status: telegramPeriodicSyncEnabled ? 'Enabled' : 'Disabled',
			tone: telegramPeriodicSyncEnabled ? 'warn' : 'ok',
		},
		keyProviderStatus(telegramSessionKeyProvider),
		telegramKeychainAccessStatus(telegramSessionKeyProvider),
		telegramSessionUnlockScopeStatus(),
		telegramMtprotoInteractionStatus(),
		telegramMtprotoMemoryWindowStatus(),
		workspaceProviderStatus(workspaceKeyProvider),
		workspaceKeychainAccessStatus(workspaceKeyProvider),
	];
	const calendarEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	const openAIProvider = process.env.OPENAI_API_KEY_PROVIDER?.trim() || 'env';
	const openAIConfigured =
		openAIProvider === 'os-keychain'
			? Boolean(process.env.OPENAI_API_KEYCHAIN_ACCOUNT?.trim() || 'openai-api-key')
			: Boolean(process.env.OPENAI_API_KEY?.trim());
	const aiAvailable = isAiAnalysisAvailable(process.env);

	const isOwner = workspaceId ? await isWorkspaceOwner(workspaceId, session.user.id) : false;

	return (
		<div>
			<h1 className="mb-6 text-2xl font-bold text-foreground">Settings</h1>

			<div className="space-y-6">
				<section className="rounded-lg border border-border bg-card p-6">
					<h2 className="mb-4 text-lg font-semibold text-foreground">Profile</h2>
					<div className="grid grid-cols-2 gap-4">
						<div>
							<p className="text-xs font-medium text-muted-foreground">Name</p>
							<p className="mt-0.5 text-sm text-foreground">{session.user.name || '-'}</p>
						</div>
						<div>
							<p className="text-xs font-medium text-muted-foreground">Email</p>
							<p className="mt-0.5 text-sm text-foreground">{session.user.email || '-'}</p>
						</div>
					</div>
				</section>

				<section className="rounded-lg border border-border bg-card p-6">
					<h2 className="mb-4 text-lg font-semibold text-foreground">Workspace</h2>
					<div>
						<p className="text-xs font-medium text-muted-foreground">Workspace ID</p>
						<p className="mt-0.5 font-mono text-sm text-foreground">
							{workspaceId || 'Not set up yet'}
						</p>
					</div>
				</section>

				{workspaceId && isOwner ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Invite Members</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Create invite links to add people to your workspace.
						</p>
						<InviteManager />
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Preferences</h2>
						<Suspense
							fallback={<p className="text-sm text-muted-foreground">Loading preferences...</p>}
						>
							<PreferencesSection workspaceId={workspaceId} userId={session.user.id} />
						</Suspense>
					</section>
				) : null}

				<section className="rounded-lg border border-border bg-card p-6">
					<h2 className="mb-4 text-lg font-semibold text-foreground">Telegram Connection</h2>
					<TelegramConnection
						isConnected={isConnected}
						linkingEnabled={telegramLinkingEnabled}
						sendEnabled={telegramSendEnabled}
						safetyItems={telegramSafetyItems}
					/>
				</section>

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">AI Analysis Consent</h2>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<AiAnalysisConsentSection
								workspaceId={workspaceId}
								userId={session.user.id}
								aiAvailable={aiAvailable}
							/>
						</Suspense>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">
							Feature Automation Status
						</h2>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<FeatureAutomationStatusSection
								workspaceId={workspaceId}
								userId={session.user.id}
								aiAvailable={aiAvailable}
								telegramLinkingEnabled={telegramLinkingEnabled}
								telegramSendEnabled={telegramSendEnabled}
								telegramBotEnabled={telegramBotEnabled}
								telegramPeriodicSyncEnabled={telegramPeriodicSyncEnabled}
							/>
						</Suspense>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Local Data Privacy</h2>
						<div className="grid gap-3 md:grid-cols-2">
							<PrivacyStatusItem
								label="Messages and secrets"
								status="Encrypted at rest"
								tone="ok"
							/>
							<PrivacyStatusItem
								label="Search indexes"
								status="Masked local vectors"
								tone="neutral"
							/>
							<PrivacyStatusItem label="Embedding inputs" status="Raw PII blocked" tone="ok" />
							<PrivacyStatusItem
								label="Derived-data audit"
								status="Available locally"
								tone="neutral"
							/>
						</div>
						<p className="mt-4 text-sm text-muted-foreground">
							Search, digest, and knowledge features keep local vector indexes and masked text so
							semantic recall works without persisting raw message text in those indexes.
						</p>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Morning Brief</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Receive a daily brief summarising your commitments, deals, and key contacts.
						</p>
						{telegramBotEnabled ? (
							<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
								<BriefScheduleSection workspaceId={workspaceId} userId={session.user.id} />
							</Suspense>
						) : (
							<DisabledSettingState>
								Morning brief delivery is disabled in this demo build.
							</DisabledSettingState>
						)}
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Notifications</h2>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<NotificationsSection
								workspaceId={workspaceId}
								userId={session.user.id}
								disabled={!telegramBotEnabled}
							/>
						</Suspense>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Ghosting Alerts</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Configure when to surface contacts whose conversations have gone quiet.
						</p>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<GhostingPreferencesSection workspaceId={workspaceId} userId={session.user.id} />
						</Suspense>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Relationship Detection</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Add custom phrases to detect introductions and first-meeting signals in your
							conversations. Built-in keywords are always active.
						</p>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<DetectionKeywordsSection workspaceId={workspaceId} userId={session.user.id} />
						</Suspense>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Google Calendar</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Connect your Google Calendar to automatically track meetings with contacts.
						</p>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<CalendarSection workspaceId={workspaceId} enabled={calendarEnabled} />
						</Suspense>
					</section>
				) : null}

				{workspaceId && isOwner ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Feature Flags</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Enable or disable features for this workspace.
						</p>
						<FeatureFlagsSection workspaceId={workspaceId} />
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">AI Provider</h2>
						<div className="flex items-center gap-2">
							<span
								className={`inline-block h-2 w-2 rounded-full ${openAIConfigured ? 'bg-green-500' : 'bg-muted-foreground'}`}
							/>
							<span className="text-sm text-foreground">
								OpenAI embeddings:{' '}
								{openAIConfigured
									? openAIProvider === 'os-keychain'
										? 'macOS Keychain selected'
										: 'environment key configured'
									: 'not configured'}
							</span>
						</div>
						<p className="mt-3 text-sm text-muted-foreground">
							Run <code className="rounded bg-muted px-1 py-0.5">pnpm openai:setup</code> for local
							Keychain storage. ChatGPT OAuth is not a supported API credential path for this app.
						</p>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">AI Calibration</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Personalise AI summaries, message drafts, and briefs to your communication style and
							investment approach.
						</p>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<CalibrationStatus userId={session.user.id} workspaceId={workspaceId} />
						</Suspense>
					</section>
				) : null}

				{workspaceId ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">Data Export</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Export a basic CRM JSON file with contacts, active commitments, and deals.
						</p>
						<a
							href="/api/export"
							className="inline-flex items-center rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
						>
							Export Data
						</a>
					</section>
				) : null}

				{workspaceId && isOwner ? (
					<section className="rounded-lg border border-border bg-card p-6">
						<h2 className="mb-4 text-lg font-semibold text-foreground">AI Learning</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Review AI extraction examples. Promote good corrections to Gold tier to improve future
							extraction accuracy.
						</p>
						<Link
							href="/settings/learning"
							className="inline-flex items-center rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
						>
							Review Learning Queue
						</Link>
					</section>
				) : null}

				<section className="rounded-lg border-2 border-destructive/30 bg-card p-6">
					<h2 className="mb-4 text-lg font-semibold text-destructive">Danger Zone</h2>
					<p className="mb-4 text-sm text-muted-foreground">
						Permanently delete your account and all associated data. This action is irreversible.
					</p>
					<DeleteAccount />
				</section>
			</div>
		</div>
	);
}

function DisabledSettingState({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-md border border-dashed border-border bg-muted p-3 text-sm text-muted-foreground">
			{children}
		</div>
	);
}

function PrivacyStatusItem({
	label,
	status,
	tone,
}: {
	label: string;
	status: string;
	tone: 'ok' | 'neutral' | 'warn';
}) {
	const dotClass =
		tone === 'ok' ? 'bg-green-500' : tone === 'warn' ? 'bg-yellow-500' : 'bg-muted-foreground';

	return (
		<div className="border-l border-border pl-3">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<div className="mt-2 flex items-center gap-2">
				<span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
				<span className="text-sm font-medium text-foreground">{status}</span>
			</div>
		</div>
	);
}

type FeatureAutomationTone = 'ok' | 'neutral' | 'warn' | 'blocked';

interface FeatureAutomationItem {
	feature: string;
	status: string;
	mode: string;
	detail: string;
	tone: FeatureAutomationTone;
}

function featureToneClass(tone: FeatureAutomationTone): string {
	if (tone === 'ok') return 'bg-emerald-100 text-emerald-700';
	if (tone === 'warn') return 'bg-yellow-100 text-yellow-800';
	if (tone === 'blocked') return 'bg-red-100 text-red-700';
	return 'bg-muted text-muted-foreground';
}

function envEnabled(name: string): boolean {
	return process.env[name]?.trim() === 'true';
}

async function FeatureAutomationStatusSection({
	workspaceId,
	userId,
	aiAvailable,
	telegramLinkingEnabled,
	telegramSendEnabled,
	telegramBotEnabled,
	telegramPeriodicSyncEnabled,
}: {
	workspaceId: string;
	userId: string;
	aiAvailable: boolean;
	telegramLinkingEnabled: boolean;
	telegramSendEnabled: boolean;
	telegramBotEnabled: boolean;
	telegramPeriodicSyncEnabled: boolean;
}) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	const calibration = envelope ? await getCalibration(userId, workspaceId, envelope) : null;
	const aiConsent = calibration?.consentAiAnalysis === true;
	const knowledgeExtractionEnabled =
		envEnabled('KNOWLEDGE_EXTRACTION_ENABLED') ||
		(await isFeatureEnabled('knowledge_extraction', workspaceId));
	const knowledgeAutoEnabled = envEnabled('KNOWLEDGE_AUTO_ANALYSIS_ENABLED');
	const recommendationsEnabled = await isFeatureEnabled('recommendations', workspaceId);
	const semanticSearchEnabled = envEnabled('AI_SEARCH_EMBEDDINGS_ENABLED');
	const localAiEnabled = envEnabled('NEXT_PUBLIC_LOCAL_AI_PROCESSING_ENABLED');
	const chatProvider = process.env.CHAT_LLM_PROVIDER?.trim() || 'cloud';
	const commitmentProvider = process.env.COMMITMENT_LLM_PROVIDER?.trim() || 'cloud';
	const kgEmbeddingProvider = process.env.KNOWLEDGE_EMBEDDING_PROVIDER?.trim() || 'openai';
	const kgEmbeddingModel =
		process.env.KNOWLEDGE_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
	const kgEmbeddingDimensions = process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS?.trim() || '512';
	const digestProvider =
		process.env.DIGEST_LLM_PROVIDER?.trim() ||
		(chatProvider === 'local' ? 'local via chat runtime' : commitmentProvider);

	const aiBlockedStatus = (feature: string, detail: string): FeatureAutomationItem => ({
		feature,
		status: aiAvailable ? 'Blocked by consent' : 'Disabled by runtime',
		mode: 'Off',
		detail: aiAvailable
			? `${detail} Enable AI analysis consent to allow this feature to process imported messages.`
			: `${detail} Configure local AI or explicitly enable vendor AI egress first.`,
		tone: aiAvailable ? 'blocked' : 'warn',
	});

	const items: FeatureAutomationItem[] = [
		{
			feature: 'Telegram history import',
			status: telegramLinkingEnabled ? 'Manual import' : 'Disabled by env',
			mode: telegramLinkingEnabled ? 'Manual' : 'Off',
			detail: telegramLinkingEnabled
				? 'Users choose an account and start or resume an import. The MTProto session unlock stays scoped to the import run.'
				: 'Public/demo defaults hide Telegram linking and reject import routes.',
			tone: telegramLinkingEnabled ? 'ok' : 'neutral',
		},
		aiConsent
			? {
					feature: 'Post-import local analysis',
					status: 'Automatic after import',
					mode: 'Auto',
					detail: `New contact-linked import messages are buffered for local analysis using ${commitmentProvider === 'local' ? 'Qwen' : commitmentProvider} and ${kgEmbeddingProvider} ${kgEmbeddingModel} (${kgEmbeddingDimensions}d).`,
					tone: 'ok',
				}
			: aiBlockedStatus(
					'Post-import local analysis',
					'History imports still save encrypted messages, but commitment and knowledge extraction are not queued.',
				),
		{
			feature: 'Search',
			status: semanticSearchEnabled ? 'Manual with semantic recall' : 'Manual exact/local text',
			mode: 'Manual',
			detail: semanticSearchEnabled
				? `Search can use masked ${kgEmbeddingProvider} embeddings. Commitment search also uses encrypted-text fallback.`
				: 'Search remains manual and avoids query embeddings until semantic search is enabled.',
			tone: semanticSearchEnabled ? 'ok' : 'neutral',
		},
		aiConsent
			? {
					feature: 'Knowledge graph',
					status: knowledgeAutoEnabled
						? 'Automatic daily plus manual'
						: knowledgeExtractionEnabled
							? 'Manual and post-import'
							: 'Disabled by feature flag',
					mode: knowledgeAutoEnabled ? 'Auto' : knowledgeExtractionEnabled ? 'Manual' : 'Off',
					detail: knowledgeExtractionEnabled
						? `Uses ${kgEmbeddingProvider} ${kgEmbeddingModel} (${kgEmbeddingDimensions}d). Nightly analysis is ${knowledgeAutoEnabled ? 'enabled' : 'off'}.`
						: 'Knowledge extraction must be enabled by env or workspace feature flag before new graph work is queued.',
					tone: knowledgeExtractionEnabled ? 'ok' : 'warn',
				}
			: aiBlockedStatus(
					'Knowledge graph',
					'Existing nodes can still be viewed, but new local analysis is blocked.',
				),
		aiConsent
			? {
					feature: 'Digest generation',
					status: 'Manual generation',
					mode: 'Manual',
					detail: `Digest requests use ${digestProvider} and the current batching limits. No digest is generated on import by default.`,
					tone: 'neutral',
				}
			: aiBlockedStatus(
					'Digest generation',
					'Existing digests can be viewed, but new daily or weekly digests are blocked.',
				),
		aiConsent
			? {
					feature: 'Chat assistant',
					status: 'Manual chat',
					mode: 'Manual',
					detail: `Chat uses the ${chatProvider} runtime. Tool actions still require user confirmation before writing CRM data.`,
					tone: localAiEnabled || chatProvider === 'local' ? 'ok' : 'neutral',
				}
			: aiBlockedStatus(
					'Chat assistant',
					'Chat over imported messages is blocked until AI analysis consent is on.',
				),
		{
			feature: 'Introductions and recommendations',
			status: recommendationsEnabled ? 'Partial automation' : 'Manual or disabled',
			mode: recommendationsEnabled ? 'Mixed' : 'Manual',
			detail: recommendationsEnabled
				? 'Recommendations run after morning brief. Introduction detection still depends on the older cloud relationship path unless a local extractor is added.'
				: 'Manual introduction records work. Automatic recommendations require the recommendations feature flag and brief scheduling.',
			tone: recommendationsEnabled ? 'warn' : 'neutral',
		},
		{
			feature: 'Telegram sends and notifications',
			status:
				telegramSendEnabled || telegramBotEnabled || telegramPeriodicSyncEnabled
					? 'Some enabled'
					: 'Disabled',
			mode: telegramPeriodicSyncEnabled ? 'Auto' : telegramBotEnabled ? 'Scheduled' : 'Off',
			detail: telegramSendEnabled
				? 'Outbound sends are enabled; review rate limits and confirmation UI before using real accounts.'
				: 'Outbound sends, bot delivery, and periodic sync remain off in the safe local/public posture.',
			tone: telegramSendEnabled || telegramPeriodicSyncEnabled ? 'warn' : 'ok',
		},
	];

	return (
		<div className="space-y-3">
			<div className="grid gap-2 md:grid-cols-2">
				{items.map((item) => (
					<div key={item.feature} className="border-l border-border pl-3">
						<div className="flex flex-wrap items-center gap-2">
							<p className="text-sm font-medium text-foreground">{item.feature}</p>
							<span
								className={`rounded-full px-2 py-0.5 text-xs font-medium ${featureToneClass(item.tone)}`}
							>
								{item.status}
							</span>
							<span className="text-xs text-muted-foreground">{item.mode}</span>
						</div>
						<p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
					</div>
				))}
			</div>
			<p className="text-sm text-muted-foreground">
				These rows are derived from the saved consent row, workspace feature flags, and current
				runtime environment. They describe what the app will do now, not just which model variables
				are configured.
			</p>
		</div>
	);
}

async function PreferencesSection({
	workspaceId,
	userId,
}: { workspaceId: string; userId: string }) {
	const prefs = await getPreferences(workspaceId, userId);
	return <PreferencesForm initial={prefs} />;
}

async function BriefScheduleSection({
	workspaceId,
	userId,
}: { workspaceId: string; userId: string }) {
	const prefs = await getPreferences(workspaceId, userId);
	return (
		<BriefScheduleEditor
			currentTime={prefs.briefTime}
			currentTimezone={prefs.timezone}
			currentDays={prefs.briefDays}
		/>
	);
}

async function CalendarSection({
	workspaceId,
	enabled,
}: { workspaceId: string; enabled: boolean }) {
	if (!enabled) {
		return (
			<DisabledSettingState>
				Google Calendar OAuth is not configured in this demo build.
			</DisabledSettingState>
		);
	}

	const { calendarConnections, db, eq } = await import('@repo/db');
	const [connection] = await db
		.select({ email: calendarConnections.email, lastSyncAt: calendarConnections.lastSyncAt })
		.from(calendarConnections)
		.where(eq(calendarConnections.workspaceId, workspaceId))
		.limit(1);

	if (connection) {
		return (
			<div className="flex items-center gap-3">
				<span className="inline-block h-2 w-2 rounded-full bg-green-500" />
				<span className="text-sm text-foreground">
					Connected: {connection.email || 'Google Calendar'}
				</span>
				{connection.lastSyncAt ? (
					<span className="text-xs text-muted-foreground">
						Last synced: {new Date(connection.lastSyncAt).toLocaleDateString()}
					</span>
				) : null}
			</div>
		);
	}

	return (
		<a
			href="/api/calendar"
			className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
		>
			Connect Google Calendar
		</a>
	);
}

async function AiAnalysisConsentSection({
	workspaceId,
	userId,
	aiAvailable,
}: { workspaceId: string; userId: string; aiAvailable: boolean }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	const calibration = envelope ? await getCalibration(userId, workspaceId, envelope) : null;
	return (
		<AiAnalysisConsent
			aiAvailable={aiAvailable}
			consentAiAnalysis={calibration?.consentAiAnalysis === true}
			consentDataProcessing={calibration?.consentDataProcessing === true}
			consentTelegramAccess={calibration?.consentTelegramAccess === true}
		/>
	);
}

async function DetectionKeywordsSection({
	workspaceId,
	userId,
}: { workspaceId: string; userId: string }) {
	const prefs = await getPreferences(workspaceId, userId);
	return (
		<div className="grid gap-6 md:grid-cols-2">
			<IntroKeywordsEditor
				currentKeywords={prefs.introKeywords}
				title="Introductions"
				description="Phrases that suggest one person is introducing two other people."
			/>
			<ConnectionKeywordsEditor
				currentKeywords={prefs.connectionKeywords}
				title="New connections"
				description="Phrases that suggest you just met or connected with one person."
			/>
		</div>
	);
}

async function GhostingPreferencesSection({
	workspaceId,
	userId,
}: { workspaceId: string; userId: string }) {
	const prefs = await getPreferences(workspaceId, userId);
	return (
		<GhostingPreferences
			currentStatuses={prefs.ghostingAlertStatuses}
			currentStaleDays={prefs.ghostingStaleDays}
		/>
	);
}

async function NotificationsSection({
	workspaceId,
	userId,
	disabled,
}: { workspaceId: string; userId: string; disabled: boolean }) {
	const prefs = await getPreferences(workspaceId, userId);
	return (
		<NotificationPreferences
			briefEnabled={prefs.briefEnabled}
			disabled={disabled}
			disabledReason={
				disabled ? 'Telegram notification delivery is disabled in this demo build.' : undefined
			}
		/>
	);
}

async function CalibrationStatus({ userId, workspaceId }: { userId: string; workspaceId: string }) {
	const envelope = await getWorkspaceEnvelope(workspaceId);
	const calibration = envelope ? await getCalibration(userId, workspaceId, envelope) : null;
	const isCalibrated = calibration?.completedAt != null;

	return (
		<div className="flex items-center justify-between">
			<div className="flex items-center gap-2">
				<span
					className={`inline-block h-2 w-2 rounded-full ${isCalibrated ? 'bg-green-500' : 'bg-muted-foreground'}`}
				/>
				<span className="text-sm text-foreground">
					{isCalibrated ? 'Calibrated' : 'Not yet calibrated'}
				</span>
				{isCalibrated && calibration?.updatedAt ? (
					<span className="text-xs text-muted-foreground">
						&middot; Last updated {new Date(calibration.updatedAt).toLocaleDateString()}
					</span>
				) : null}
			</div>
			<Link
				href="/calibration"
				className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
			>
				{isCalibrated ? 'Recalibrate' : 'Calibrate'}
			</Link>
		</div>
	);
}

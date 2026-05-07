import { PreferencesForm } from '@/components/preferences-form';
import { BriefScheduleEditor } from '@/components/settings/brief-schedule-editor';
import { DeleteAccount } from '@/components/settings/delete-account';
import { FeatureFlagsSection } from '@/components/settings/feature-flags';
import { GhostingPreferences } from '@/components/settings/ghosting-preferences';
import { IntroKeywordsEditor } from '@/components/settings/intro-keywords-editor';
import { InviteManager } from '@/components/settings/invite-manager';
import { NotificationPreferences } from '@/components/settings/notification-preferences';
import { TelegramConnection } from '@/components/settings/telegram-connection';
import { isRuntimeEnvEnabled } from '@/lib/runtime-env';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { isWorkspaceOwner } from '@/lib/workspace-authz';
import { accounts, and, db, eq, getCalibration, getPreferences } from '@repo/db';
import Link from 'next/link';
import { Suspense } from 'react';

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
	const calendarEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

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
						accountId={telegramAccount[0]?.accountId}
						linkingEnabled={telegramLinkingEnabled}
					/>
				</section>

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
						<h2 className="mb-4 text-lg font-semibold text-foreground">Introduction Detection</h2>
						<p className="mb-4 text-sm text-muted-foreground">
							Add custom phrases to detect introductions in your conversations. Built-in keywords
							are always active.
						</p>
						<Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
							<IntroKeywordsSection workspaceId={workspaceId} userId={session.user.id} />
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
							Export your contacts, commitments, and deals as JSON.
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

async function IntroKeywordsSection({
	workspaceId,
	userId,
}: { workspaceId: string; userId: string }) {
	const prefs = await getPreferences(workspaceId, userId);
	return <IntroKeywordsEditor currentKeywords={prefs.introKeywords} />;
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

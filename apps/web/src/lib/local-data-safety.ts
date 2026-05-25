import { accounts, chats, contacts, db, eq, sql } from '@repo/db';

const DEFAULT_DEMO_EMAIL = 'alice@gordian.dev';
const DEFAULT_DEMO_PASSWORD = 'gordian-demo';

export const DEMO_LOGIN_LOCAL_TELEGRAM_DATA_MESSAGE =
	'Demo login is disabled because this local database contains Telegram data.';
export const DEMO_LOGIN_SAFETY_CHECK_FAILED_MESSAGE =
	'Demo login is disabled until the local database safety check succeeds.';

type DemoLoginSafetyInput = {
	allowOverride?: boolean;
	demoEmail?: string;
	demoLoginEnabled?: boolean;
	demoPassword?: string;
	hasLocalTelegramData: boolean;
};

export type DemoLoginSafety = {
	disabledReason: string | null;
	email: string;
	enabled: boolean;
	password: string;
};

export function getDemoEmail() {
	return process.env.NEXT_PUBLIC_DEMO_EMAIL?.trim() || DEFAULT_DEMO_EMAIL;
}

export function getDemoPassword() {
	return (
		process.env.DEMO_PASSWORD ?? process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD
	);
}

export function isDemoLoginEnabled() {
	return process.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED === 'true';
}

export function isDemoLoginLocalTelegramDataOverrideEnabled() {
	return process.env.ALLOW_DEMO_LOGIN_WITH_LOCAL_TELEGRAM_DATA === 'true';
}

export function isDemoCredentialEmail(email: unknown, demoEmail = getDemoEmail()) {
	return typeof email === 'string' && email.trim().toLowerCase() === demoEmail.trim().toLowerCase();
}

export function shouldBlockDemoCredentialSignIn({
	allowOverride = isDemoLoginLocalTelegramDataOverrideEnabled(),
	demoEmail = getDemoEmail(),
	demoLoginEnabled = isDemoLoginEnabled(),
	email,
	hasLocalTelegramData,
}: {
	allowOverride?: boolean;
	demoEmail?: string;
	demoLoginEnabled?: boolean;
	email: unknown;
	hasLocalTelegramData: boolean;
}) {
	return (
		demoLoginEnabled &&
		hasLocalTelegramData &&
		!allowOverride &&
		isDemoCredentialEmail(email, demoEmail)
	);
}

export function resolveDemoLoginSafety({
	allowOverride = isDemoLoginLocalTelegramDataOverrideEnabled(),
	demoEmail = getDemoEmail(),
	demoLoginEnabled = isDemoLoginEnabled(),
	demoPassword = getDemoPassword(),
	hasLocalTelegramData,
}: DemoLoginSafetyInput): DemoLoginSafety {
	const blocked = demoLoginEnabled && hasLocalTelegramData && !allowOverride;

	return {
		disabledReason: blocked ? DEMO_LOGIN_LOCAL_TELEGRAM_DATA_MESSAGE : null,
		email: demoEmail,
		enabled: demoLoginEnabled,
		password: blocked ? '' : demoPassword,
	};
}

export async function hasLocalTelegramData() {
	const [telegramAccount] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(eq(accounts.providerId, 'telegram'))
		.limit(1);
	if (telegramAccount) return true;

	const [telegramContact] = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(sql`${contacts.sourceAccountId} IS NOT NULL`)
		.limit(1);
	if (telegramContact) return true;

	const [telegramChat] = await db
		.select({ id: chats.id })
		.from(chats)
		.where(sql`${chats.sourceAccountId} IS NOT NULL`)
		.limit(1);
	return Boolean(telegramChat);
}

export async function getDemoLoginSafety() {
	if (!isDemoLoginEnabled()) {
		return resolveDemoLoginSafety({ demoLoginEnabled: false, hasLocalTelegramData: false });
	}

	try {
		return resolveDemoLoginSafety({
			hasLocalTelegramData: await hasLocalTelegramData(),
		});
	} catch {
		return {
			disabledReason: DEMO_LOGIN_SAFETY_CHECK_FAILED_MESSAGE,
			email: getDemoEmail(),
			enabled: true,
			password: '',
		};
	}
}

export async function shouldBlockDemoCredentialSignInForRequest(email: unknown) {
	if (
		!isDemoLoginEnabled() ||
		isDemoLoginLocalTelegramDataOverrideEnabled() ||
		!isDemoCredentialEmail(email)
	) {
		return false;
	}

	try {
		return shouldBlockDemoCredentialSignIn({
			email,
			hasLocalTelegramData: await hasLocalTelegramData(),
		});
	} catch {
		return true;
	}
}

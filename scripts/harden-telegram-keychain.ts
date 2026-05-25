import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTelegramSessionKeyProvider, rehardenSessionKek } from '@repo/crypto';
import { accounts, db, sql } from '@repo/db';

function loadDotenvLocal(): void {
	const path = resolve(process.cwd(), '.env.local');
	if (!existsSync(path)) return;
	for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const index = line.indexOf('=');
		if (index === -1) continue;
		const key = line.slice(0, index).trim();
		const value = line
			.slice(index + 1)
			.trim()
			.replace(/^"|"$/g, '');
		process.env[key] ??= value;
	}
}

loadDotenvLocal();

async function main(): Promise<void> {
	if (getTelegramSessionKeyProvider() !== 'os-keychain') {
		throw new Error('telegram:keychain:harden requires TELEGRAM_SESSION_KEY_PROVIDER=os-keychain');
	}

	const requiresUserPresence =
		process.env.TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE?.trim() === 'true';

	const rows = await db
		.select({
			userId: accounts.userId,
			sessionKekEncrypted: accounts.sessionKekEncrypted,
		})
		.from(accounts)
		.where(
			sql`${accounts.providerId} = 'telegram' AND ${accounts.sessionKekEncrypted} IS NOT NULL`,
		);

	let hardened = 0;
	for (const row of rows) {
		if (!row.sessionKekEncrypted) continue;
		await rehardenSessionKek(row.userId, row.sessionKekEncrypted);
		hardened += 1;
	}

	console.log(
		`[telegram-keychain-harden] Re-stored ${hardened} Telegram session Keychain item(s) with ${requiresUserPresence ? 'user-presence' : 'WhenUnlocked'} policy.`,
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteSessionKek, getTelegramSessionKeyProvider, rehardenSessionKek } from '@repo/crypto';
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
			id: accounts.id,
			userId: accounts.userId,
			sessionKekEncrypted: accounts.sessionKekEncrypted,
		})
		.from(accounts)
		.where(
			sql`${accounts.providerId} = 'telegram' AND ${accounts.sessionKekEncrypted} IS NOT NULL`,
		);

	let hardened = 0;
	let rehomed = 0;
	let missing = 0;
	for (const row of rows) {
		if (!row.sessionKekEncrypted) continue;
		let updatedBlob: Buffer | undefined;
		try {
			updatedBlob = await rehardenSessionKek(row.userId, row.sessionKekEncrypted);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('Keychain item could not be found')) {
				missing += 1;
				console.warn(
					`[telegram-keychain-harden] Skipped account ${row.id}: stored Keychain marker is missing locally; reconnect that Telegram account to restore it.`,
				);
				continue;
			}
			throw err;
		}
		if (updatedBlob) {
			await db
				.update(accounts)
				.set({ sessionKekEncrypted: updatedBlob })
				.where(sql`${accounts.id} = ${row.id}`);
			await deleteSessionKek(row.userId, row.sessionKekEncrypted).catch(() => {});
			rehomed += 1;
		}
		hardened += 1;
	}

	console.log(
		`[telegram-keychain-harden] Re-stored ${hardened} Telegram session Keychain item(s) with ${requiresUserPresence ? 'user-presence' : 'WhenUnlocked'} policy; re-homed ${rehomed} marker(s) to the configured Telegram service; skipped ${missing} missing marker(s).`,
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});

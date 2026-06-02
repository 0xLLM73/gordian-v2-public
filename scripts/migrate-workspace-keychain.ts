#!/usr/bin/env tsx

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	deleteWorkspaceWrk,
	isWorkspaceKeychainMarker,
	storeWorkspaceWrkInKeychain,
	unwrapWrk,
} from '@repo/crypto';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerRequire = createRequire(path.resolve(__dirname, '../apps/worker/package.json'));
const postgres = workerRequire('postgres') as typeof import('postgres').default;
config({ path: path.resolve(__dirname, '../.env.local') });
process.env.NODE_ENV ??= 'development';

type WorkspaceRow = {
	id: string;
	encrypted_wrk: string;
};

const WORKSPACE_KEYCHAIN_MARKER_PREFIX = 'gordian:keychain:workspace-wrk:v1:';

function desiredWorkspaceKeychainService(): string {
	return (
		process.env.WORKSPACE_KEYCHAIN_SERVICE?.trim() ||
		process.env.GORDIAN_KEYCHAIN_SERVICE?.trim() ||
		'gordian-v2-workspace'
	);
}

function workspaceMarkerService(encryptedWrk: Buffer): string | null {
	const encoded = encryptedWrk.toString('utf8');
	if (!encoded.startsWith(WORKSPACE_KEYCHAIN_MARKER_PREFIX)) return null;
	const parsed = JSON.parse(encoded.slice(WORKSPACE_KEYCHAIN_MARKER_PREFIX.length)) as {
		service?: unknown;
	};
	return typeof parsed.service === 'string' ? parsed.service : null;
}

function parseArgs() {
	const args = new Set(process.argv.slice(2));
	return {
		apply: args.has('--apply'),
		help: args.has('--help') || args.has('-h'),
	};
}

function printHelp() {
	console.log(`Usage: pnpm workspace-key:migrate-local-keychain [--apply]

Moves local dev workspace root keys out of Postgres and into macOS Keychain.

Default mode is dry-run. It prints counts only and never prints key material.

Options:
  --apply   Write Keychain items and replace workspaces.encrypted_wrk with markers.
  --help    Show this help text.
`);
}

function isLocalPostgresUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
	} catch {
		return false;
	}
}

function short(id: string): string {
	return id.slice(0, 8);
}

async function main() {
	const args = parseArgs();
	if (args.help) {
		printHelp();
		return;
	}

	if (process.platform !== 'darwin') {
		throw new Error('macOS Keychain migration requires macOS.');
	}

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required.');
	}
	if (!isLocalPostgresUrl(databaseUrl)) {
		throw new Error('Refusing to migrate a non-local DATABASE_URL.');
	}

	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	const counts = {
		alreadyKeychain: 0,
		migrated: 0,
		rehomed: 0,
		rawLocalWrk: 0,
		skippedUnsupported: 0,
		total: 0,
	};
	const targetService = desiredWorkspaceKeychainService();

	try {
		const rows = await sql<WorkspaceRow[]>`
			SELECT id::text, encrypted_wrk
			FROM workspaces
			ORDER BY created_at, id
		`;

		for (const row of rows) {
			counts.total++;
			const encryptedWrk = Buffer.from(row.encrypted_wrk, 'base64');
			try {
				if (isWorkspaceKeychainMarker(encryptedWrk)) {
					const currentService = workspaceMarkerService(encryptedWrk);
					if (currentService && currentService !== targetService) {
						if (!args.apply) {
							console.log(
								`DRY-RUN workspace=${short(row.id)} Keychain marker would move from ${currentService} to ${targetService}.`,
							);
							continue;
						}

						const wrk = await unwrapWrk({
							encryptedWrk,
							kmsContext: { WorkspaceID: row.id, Purpose: 'workspace-root-key' },
							wrkVersion: 1,
						});
						try {
							const marker = await storeWorkspaceWrkInKeychain(row.id, wrk);
							try {
								await sql`
									UPDATE workspaces
									SET encrypted_wrk = ${marker.toString('base64')}
									WHERE id = ${row.id}
								`;
								counts.rehomed++;
								console.log(
									`RE-HOMED workspace=${short(row.id)} Keychain marker to ${targetService}.`,
								);
								await deleteWorkspaceWrk(row.id, encryptedWrk).catch(() => {});
							} catch (error) {
								await deleteWorkspaceWrk(row.id, marker).catch(() => {});
								throw error;
							} finally {
								marker.fill(0);
							}
						} finally {
							wrk.fill(0);
						}
						continue;
					}
					counts.alreadyKeychain++;
					continue;
				}

				if (encryptedWrk.length !== 32) {
					counts.skippedUnsupported++;
					console.log(
						`SKIP workspace=${short(row.id)} unsupported WRK blob shape; likely AWS KMS ciphertext.`,
					);
					continue;
				}

				counts.rawLocalWrk++;
				if (!args.apply) {
					console.log(`DRY-RUN workspace=${short(row.id)} raw local WRK would move to Keychain.`);
					continue;
				}

				const marker = await storeWorkspaceWrkInKeychain(row.id, encryptedWrk);
				try {
					await sql`
						UPDATE workspaces
						SET encrypted_wrk = ${marker.toString('base64')}
						WHERE id = ${row.id}
					`;
					counts.migrated++;
					console.log(`MIGRATED workspace=${short(row.id)} to macOS Keychain marker.`);
				} catch (error) {
					await deleteWorkspaceWrk(row.id, marker).catch(() => {});
					throw error;
				} finally {
					marker.fill(0);
				}
			} finally {
				encryptedWrk.fill(0);
			}
		}

		console.log(
			JSON.stringify(
				{
					status: args.apply ? 'applied' : 'dry-run',
					counts,
					nextEnv: {
						WORKSPACE_KEY_PROVIDER: 'os-keychain',
						WORKSPACE_KEYCHAIN_SERVICE: targetService,
						WORKSPACE_KEY_CACHE_TTL_MINUTES: process.env.WORKSPACE_KEY_CACHE_TTL_MINUTES || '60',
					},
				},
				null,
				2,
			),
		);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

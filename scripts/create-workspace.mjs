/**
 * One-off script to create a workspace for an existing user using dev WRK bypass.
 * Run: set -a && source .env && set +a && node scripts/create-workspace.mjs
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireDb = createRequire(join(__dirname, '..', 'packages', 'db', 'package.json'));
const postgres = requireDb('postgres');

// SEC-KMS-004: Prevent accidental execution against production
if (process.env.NODE_ENV === 'production' || process.env.FLY_APP_NAME || process.env.COOLIFY_URL) {
	console.error('This script is for local development only. It stores a raw (unwrapped) WRK.');
	process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('Missing DATABASE_URL');
	process.exit(1);
}

const USER_ID = process.env.USER_ID || '0f00ea64-95c5-4f96-ae2f-80fc560816d5';
const WORKSPACE_NAME = process.env.WORKSPACE_NAME || 'My Workspace';

const sql = postgres(DATABASE_URL, { prepare: false });

async function main() {
	// 1. Generate a workspace ID
	const [{ id: workspaceId }] = await sql`SELECT gen_random_uuid() as id`;
	console.log('Workspace ID:', workspaceId);

	// 2. Generate a random 32-byte WRK (dev bypass — no KMS wrapping)
	const devWrk = randomBytes(32);
	const encryptedWrkBase64 = devWrk.toString('base64');
	const kmsContext = { WorkspaceID: workspaceId };
	console.log('Dev WRK generated (length:', devWrk.length, 'bytes)');

	// 3. Insert workspace
	await sql`
		INSERT INTO workspaces (id, name, owner_id, encrypted_wrk, kms_context, wrk_version)
		VALUES (${workspaceId}, ${WORKSPACE_NAME}, ${USER_ID}, ${encryptedWrkBase64}, ${sql.json(kmsContext)}, 1)
	`;
	console.log('Workspace created');

	// 4. Insert workspace member (owner)
	await sql`
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES (${workspaceId}, ${USER_ID}, 'owner')
	`;
	console.log('Workspace member created (owner)');

	// 5. Verify
	const [ws] =
		await sql`SELECT id, name, owner_id, wrk_version FROM workspaces WHERE id = ${workspaceId}`;
	console.log('Verified:', ws);

	console.log('\n=== IMPORTANT ===');
	console.log('This workspace stores a raw dev WRK. Run migrate-wrk-to-kms.mjs to wrap with KMS.');

	await sql.end();
}

main().catch((err) => {
	console.error('Error:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

const args = new Set(process.argv.slice(2));
const allowSensitiveInspection = process.env.ALLOW_SENSITIVE_DB_INSPECTION === 'true';
const countsOnly = args.has('--counts-only');

if (args.has('--help') || args.has('-h')) {
	console.log(`Usage:
  node scripts/check-db.mjs --counts-only
  ALLOW_SENSITIVE_DB_INSPECTION=true node scripts/check-db.mjs

Default mode refuses to run because it can print user, workspace, and Telegram
account identifiers. Use --counts-only for non-sensitive table counts.`);
	process.exit(0);
}

if (!countsOnly && !allowSensitiveInspection) {
	console.error(
		'Refusing privileged DB inspection. This script can print user, workspace, and Telegram account identifiers. Use --counts-only or set ALLOW_SENSITIVE_DB_INSPECTION=true for an explicitly approved local inspection.',
	);
	process.exit(1);
}

if (!process.env.DATABASE_URL) {
	console.error('Missing DATABASE_URL');
	process.exit(1);
}

const { default: postgres } = await import('postgres');
const sql = postgres(process.env.DATABASE_URL);

if (countsOnly) {
	const tables = ['users', 'workspaces', 'workspace_members', 'contacts', 'accounts'];
	for (const table of tables) {
		try {
			const result = await sql`SELECT count(*) as cnt FROM ${sql(table)}`;
			console.log(`${table.toUpperCase()} COUNT:`, result[0].cnt);
		} catch (_e) {
			console.log(`${table.toUpperCase()} COUNT: unavailable`);
		}
	}
	await sql.end();
	process.exit(0);
}

const users = await sql`SELECT id, name, email FROM users LIMIT 5`;
console.log('USERS:', JSON.stringify(users, null, 2));

const workspaces = await sql`SELECT id, name, owner_id FROM workspaces LIMIT 5`;
console.log('WORKSPACES:', JSON.stringify(workspaces, null, 2));

const members = await sql`SELECT user_id, workspace_id, role FROM workspace_members LIMIT 5`;
console.log('MEMBERS:', JSON.stringify(members, null, 2));

const contacts = await sql`SELECT count(*) as cnt FROM contacts`;
console.log('CONTACTS COUNT:', contacts[0].cnt);

// Check if contact_tags table exists
try {
	const tags = await sql`SELECT count(*) as cnt FROM contact_tags`;
	console.log('CONTACT_TAGS COUNT:', tags[0].cnt);
} catch (_e) {
	console.log('CONTACT_TAGS TABLE: does not exist yet');
}

// Check accounts for telegram linkage
const accounts = await sql`SELECT user_id, provider_id, account_id FROM accounts LIMIT 10`;
console.log('ACCOUNTS:', JSON.stringify(accounts, null, 2));

await sql.end();

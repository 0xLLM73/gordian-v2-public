import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

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

import { config } from 'dotenv';
config({ path: '.env.local' });

const { default: postgres } = await import('postgres');
const sql = postgres(process.env.DATABASE_URL);

// Check if user_preferences table exists
try {
	const result = await sql`SELECT count(*) as cnt FROM user_preferences`;
	console.log('user_preferences table exists, rows:', result[0].cnt);
} catch (e) {
	console.log('user_preferences table: DOES NOT EXIST -', e.message.split('\n')[0]);
}

// Check users + workspaces
const users = await sql`SELECT id, name, email FROM users LIMIT 5`;
console.log('USERS:', JSON.stringify(users, null, 2));

const workspaces = await sql`SELECT id, name, owner_id FROM workspaces LIMIT 5`;
console.log('WORKSPACES:', JSON.stringify(workspaces, null, 2));

const members = await sql`SELECT user_id, workspace_id FROM workspace_members LIMIT 5`;
console.log('MEMBERS:', JSON.stringify(members, null, 2));

// Check digest_focus enum
try {
	const enums = await sql`SELECT enum_range(NULL::digest_focus)`;
	console.log('digest_focus enum:', enums[0].enum_range);
} catch (_e) {
	console.log('digest_focus enum: DOES NOT EXIST');
}

await sql.end();

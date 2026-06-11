import { randomUUID } from 'node:crypto';
import { generateWorkspaceWrk } from '@repo/crypto';
import { accounts, closeDb, createWorkspace, db, eq, sql, users } from '@repo/db';
import { hashPassword } from 'better-auth/crypto';
import { loadRootEnv } from './lib/load-root-env.mjs';
import {
	parseLocalOwnerBootstrapArgs,
	shouldRefuseForExistingUsers,
	validateLocalOwnerBootstrapConfig,
} from './lib/local-owner-bootstrap.mjs';
import { isLocalServiceUrl, redactUrl } from './lib/local-runtime-safety.mjs';

function printHelp() {
	console.log(`Usage: pnpm bootstrap:local-owner [options]

Creates the first local workspace owner without enabling public signup.
This command is for fresh local development databases only.

Options:
  --email <email>            Owner email. Defaults to LOCAL_OWNER_EMAIL or owner@gordian.local.
  --name <name>              Owner display name. Defaults to LOCAL_OWNER_NAME or Local Owner.
  --workspace <name>         Workspace name. Defaults to LOCAL_OWNER_WORKSPACE or Local Workspace.
  --password <password>      Owner password. Defaults to LOCAL_OWNER_PASSWORD or a generated password.
  --allow-existing-users     Allow creating an owner when users already exist.
  --dry-run                  Validate config and target without writing.
  --help                     Show this help text.

Secret values are never read from or written to git. If a password is generated,
it is printed once for local sign-in and is not stored outside Better Auth.
`);
}

function assertLocalOnlyTarget() {
	if (
		process.env.NODE_ENV === 'production' ||
		process.env.FLY_APP_NAME ||
		process.env.COOLIFY_URL
	) {
		throw new Error('Local owner bootstrap refuses production/deployment environments');
	}

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('DATABASE_URL is required');
	if (!isLocalServiceUrl(databaseUrl)) {
		throw new Error(
			`Local owner bootstrap refuses nonlocal DATABASE_URL (${redactUrl(databaseUrl)})`,
		);
	}

	const directUrl = process.env.DIRECT_URL;
	if (directUrl && !isLocalServiceUrl(directUrl)) {
		throw new Error(`Local owner bootstrap refuses nonlocal DIRECT_URL (${redactUrl(directUrl)})`);
	}
}

async function getUserCount(): Promise<number> {
	const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
	return Number(row?.count ?? 0);
}

async function main() {
	loadRootEnv();

	const config = parseLocalOwnerBootstrapArgs(process.argv.slice(2));
	if (config.help) {
		printHelp();
		return;
	}

	validateLocalOwnerBootstrapConfig(config);
	assertLocalOnlyTarget();

	const userCount = await getUserCount();
	if (shouldRefuseForExistingUsers(userCount, config.allowExistingUsers)) {
		throw new Error(
			`Refusing to bootstrap a local owner because ${userCount} user(s) already exist. Use workspace invites, or pass --allow-existing-users only for an intentional local repair.`,
		);
	}

	if (config.dryRun) {
		console.log('Local owner bootstrap dry run passed.');
		console.log(`Target email: ${config.email}`);
		console.log(`Workspace: ${config.workspace}`);
		console.log(`Existing users: ${userCount}`);
		return;
	}

	const [existingUser] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, config.email))
		.limit(1);
	if (existingUser) {
		throw new Error(`A user already exists for ${config.email}`);
	}

	const [user] = await db
		.insert(users)
		.values({
			email: config.email,
			emailVerified: true,
			name: config.name,
		})
		.returning({ id: users.id });
	if (!user) throw new Error('Failed to create local owner user');

	await db.insert(accounts).values({
		accountId: user.id,
		providerId: 'credential',
		userId: user.id,
		password: await hashPassword(config.password),
	});

	const workspaceId = randomUUID();
	const { encryptedWrk, kmsContext } = await generateWorkspaceWrk(workspaceId);
	const workspace = await createWorkspace(
		user.id,
		config.workspace,
		encryptedWrk.toString('base64'),
		kmsContext,
		{ id: workspaceId },
	);

	console.log('Created local owner account.');
	console.log(`Email: ${config.email}`);
	console.log(`Password: ${config.password}`);
	if (config.generatedPassword) {
		console.log('Password source: generated once; store it locally if you need it again.');
	} else {
		console.log('Password source: provided by LOCAL_OWNER_PASSWORD or --password.');
	}
	console.log(`Workspace: ${workspace.name}`);
	console.log(`Workspace ID: ${workspace.id}`);
	console.log('Next: pnpm --dir apps/web dev, then sign in through /login.');
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	})
	.finally(async () => {
		await closeDb();
	});

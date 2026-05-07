import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedSessionText, encryptedText } from './custom-types';
import { users } from './users';

/** Raw bytea column for KMS ciphertext blobs */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => 'bytea',
	fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v as Buffer)),
	toDriver: (v) => v,
});

/**
 * Better Auth required tables: session, account, verification.
 * These are managed by Better Auth's Drizzle adapter.
 * Table/column names follow Better Auth's expected schema.
 *
 * IDs use text type with gen_random_uuid()::text default so Better Auth
 * can pass either its own ID or let the DB generate one.
 */

export const sessions = pgTable(
	'sessions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const accounts = pgTable(
	'accounts',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		accessToken: encryptedSessionText('access_token'),
		refreshToken: encryptedText('refresh_token'),
		idToken: encryptedText('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		/** KMS-encrypted per-user KEK blob. null = legacy TSK-encrypted session */
		sessionKekEncrypted: bytea('session_kek_encrypted'),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('accounts_user_id_idx').on(table.userId)],
);

export const verifications = pgTable('verifications', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

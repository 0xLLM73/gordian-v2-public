import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { blindIndex, encryptedText } from './custom-types';
import { workspaceRoleEnum } from './enums';
import { users } from './users';

export const workspaces = pgTable('workspaces', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	ownerId: uuid('owner_id')
		.references(() => users.id)
		.notNull(),
	/** Encrypted WRK blob (Base64) */
	encryptedWrk: text('encrypted_wrk').notNull(),
	/** KMS Encryption Context as JSON */
	kmsContext: jsonb('kms_context').notNull(),
	/** Current WRK version for rotation */
	wrkVersion: integer('wrk_version').default(1).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceMembers = pgTable('workspace_members', {
	id: uuid('id').primaryKey().defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	role: workspaceRoleEnum('role').default('member').notNull(),
	joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceInvites = pgTable(
	'workspace_invites',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		email: encryptedText('email'),
		emailBlindIndex: blindIndex('email_blind_index'),
		role: workspaceRoleEnum('role').default('member').notNull(),
		token: text('token').notNull().unique(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		createdBy: uuid('created_by')
			.references(() => users.id)
			.notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('workspace_invites_email_bidx_idx').on(table.emailBlindIndex)],
);

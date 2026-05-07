import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { contactPriorityEnum, contactRelationshipEnum, contactStatusEnum } from './enums';

export const contactTags = pgTable('contact_tags', {
	id: uuid('id').defaultRandom().primaryKey(),
	contactId: uuid('contact_id').notNull().unique(),
	workspaceId: uuid('workspace_id').notNull(),
	relationship: contactRelationshipEnum('relationship'),
	priority: contactPriorityEnum('priority').default('medium'),
	status: contactStatusEnum('status').default('new'),
	customTags: text('custom_tags').array(),
	goal: encryptedText('goal'),
	notes: encryptedText('notes'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

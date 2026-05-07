import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { blindIndex, encryptedText, halfvec } from './custom-types';
import { workspaces } from './workspaces';

export const knowledgeNodeTypeEnum = pgEnum('knowledge_node_type', [
	'topic',
	'project',
	'organization',
	'technology',
	'sector',
	'concept',
	'rationale',
	'decision',
	'outcome',
]);

export const knowledgeContactRelTypeEnum = pgEnum('knowledge_contact_rel_type', [
	'knows_about',
	'works_on',
	'member_of',
	'expert_in',
	'uses',
	'invested_in',
	'interested_in',
	'decided',
	'experienced_outcome',
]);

export const knowledgeLinkTypeEnum = pgEnum('knowledge_link_type', [
	'part_of',
	'related_to',
	'competes_with',
	'builds_on',
	'funds',
	'uses',
	'cites',
	'led_to',
	'preceded_by',
	'contradicts',
]);

/**
 * Knowledge graph nodes — named entities extracted from messages.
 * Deduplicated on (workspace_id, name, type). embedding uses halfvec(512)
 * (P3: reduced from vector(1536) for 67% storage savings + faster HNSW).
 *
 * NOTE: The HNSW index is created in migration 0023_knowledge_nodes.sql,
 * not via Drizzle (halfvec is a customType without .op() support).
 *
 * SEC-ENC-501: unique constraint uses nameBlindIndex (not encrypted name) because
 * encrypted values have randomized IVs — every ciphertext is unique.
 */
export const knowledgeNodes = pgTable(
	'knowledge_nodes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		type: knowledgeNodeTypeEnum('type').notNull(),
		/** Normalized lowercase — used for dedup */
		name: encryptedText('name').notNull(),
		/** Original casing for display */
		displayName: encryptedText('display_name').notNull(),
		description: encryptedText('description'),
		/** HMAC blind index for dedup queries on name */
		nameBlindIndex: blindIndex('name_blind_index'),
		aliases: text('aliases').array().default([]),
		/** halfvec(512) — P3 reduced from vector(1536) for cost optimization */
		embedding: halfvec('embedding'),
		mentionCount: integer('mention_count').notNull().default(1),
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
		/** Subsystem-specific payload — deal ID, outcome result, action type, etc. */
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('knowledge_nodes_workspace_idx').on(table.workspaceId),
		uniqueIndex('knowledge_nodes_bidx_workspace_uniq').on(
			table.workspaceId,
			table.nameBlindIndex,
			table.type,
		),
		index('knowledge_nodes_name_bidx_idx').on(table.nameBlindIndex),
	],
);

/**
 * Join table linking knowledge nodes to contacts.
 * Idempotent upsert on (knowledge_node_id, contact_id, relation_type):
 * repeated evidence increments evidenceCount and updates strength.
 */
export const knowledgeContacts = pgTable(
	'knowledge_contacts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id').notNull(),
		knowledgeNodeId: uuid('knowledge_node_id')
			.notNull()
			.references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
		contactId: uuid('contact_id')
			.notNull()
			.references(() => contacts.id, { onDelete: 'cascade' }),
		relationType: knowledgeContactRelTypeEnum('relation_type').notNull(),
		/** 0.0–1.0 confidence score, updated on each upsert */
		strength: real('strength').notNull().default(1.0),
		/** Incremented on each repeated evidence observation */
		evidenceCount: integer('evidence_count').notNull().default(1),
		lastEvidenceAt: timestamp('last_evidence_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('knowledge_contacts_node_contact_type_uniq').on(
			table.knowledgeNodeId,
			table.contactId,
			table.relationType,
		),
		index('knowledge_contacts_contact_idx').on(table.contactId),
		index('knowledge_contacts_node_idx').on(table.knowledgeNodeId),
	],
);

/**
 * Tracks when knowledge extraction last ran for each contact.
 * Used to skip re-extraction when no new messages have arrived.
 * Upsert on (workspace_id, contact_id).
 */
export const knowledgeExtractionLog = pgTable(
	'knowledge_extraction_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		contactId: uuid('contact_id')
			.notNull()
			.references(() => contacts.id, { onDelete: 'cascade' }),
		/** When extraction last ran */
		lastExtractedAt: timestamp('last_extracted_at', { withTimezone: true }).notNull().defaultNow(),
		/** Latest message timestamp included in the extraction */
		messageHorizon: timestamp('message_horizon', { withTimezone: true }),
		/** Number of entities extracted in the last run */
		entitiesExtracted: integer('entities_extracted').notNull().default(0),
		/** Whether the LLM was called (false = embedding-only match) */
		llmCalled: integer('llm_called').notNull().default(0),
	},
	(table) => [
		uniqueIndex('knowledge_extraction_log_ws_contact_uniq').on(table.workspaceId, table.contactId),
	],
);

/**
 * Directed edges between knowledge nodes within a workspace.
 * Represents semantic relationships inferred from co-occurrence and
 * embedding similarity (via Nereid's inference pipeline).
 * Idempotent on (workspace_id, source_node_id, target_node_id, link_type).
 */
export const knowledgeLinks = pgTable(
	'knowledge_links',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		sourceNodeId: uuid('source_node_id')
			.notNull()
			.references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
		targetNodeId: uuid('target_node_id')
			.notNull()
			.references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
		linkType: knowledgeLinkTypeEnum('link_type').notNull(),
		/** 0.0–1.0 — higher means stronger evidence for the relationship */
		weight: real('weight'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('knowledge_links_edge_uniq').on(
			table.workspaceId,
			table.sourceNodeId,
			table.targetNodeId,
			table.linkType,
		),
		index('knowledge_links_source_idx').on(table.sourceNodeId, table.workspaceId),
		index('knowledge_links_target_idx').on(table.targetNodeId, table.workspaceId),
	],
);

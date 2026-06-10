import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function readRoot(relativePath: string) {
	return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

const schemaContracts = [
	{
		category: 'Contact identity fields',
		path: 'packages/db/src/schema/contacts.ts',
		fragments: [
			"firstName: encryptedText('first_name')",
			"lastName: encryptedText('last_name')",
			"username: encryptedText('username')",
			"phone: encryptedText('phone')",
			"email: encryptedText('email')",
			"notes: encryptedText('notes')",
			"sourceAccountId: text('source_account_id')",
		],
	},
	{
		category: 'Telegram identifiers and thread IDs',
		path: 'packages/db/src/schema/chats.ts',
		fragments: [
			"telegramChatId: text('telegram_chat_id').notNull()",
			"sourceAccountId: text('source_account_id')",
			"title: encryptedText('title')",
			"username: encryptedText('username')",
		],
	},
	{
		category: 'Message bodies',
		path: 'packages/db/src/schema/messages.ts',
		fragments: [
			"telegramMessageId: text('telegram_message_id').notNull()",
			"telegramSenderId: text('telegram_sender_id')",
			"text: encryptedText('text')",
		],
	},
	{
		category: 'Session-related fields and provider tokens',
		path: 'packages/db/src/schema/auth.ts',
		fragments: [
			"token: text('token').notNull().unique()",
			"accountId: text('account_id').notNull()",
			"accessToken: encryptedSessionText('access_token')",
			"refreshToken: encryptedText('refresh_token')",
			"idToken: encryptedText('id_token')",
			"sessionKekEncrypted: bytea('session_kek_encrypted')",
		],
	},
	{
		category: 'AI prompt and output fields',
		path: 'packages/db/src/schema/follow-up-plans.ts',
		fragments: [
			"title: encryptedText('title').notNull()",
			"objective: encryptedText('objective')",
			"prompt: encryptedText('prompt').notNull()",
			"draftText: encryptedText('draft_text')",
		],
	},
	{
		category: 'Saved deal AI output',
		path: 'packages/db/src/schema/deal-ai-runs.ts',
		fragments: [
			"output: encryptedText('output').notNull()",
			"uncertainty: encryptedText('uncertainty')",
			"sourceManifest: encryptedJson('source_manifest')",
		],
	},
	{
		category: 'Embedding and derived vector fields',
		path: 'packages/db/src/schema/memories.ts',
		fragments: [
			"content: encryptedText('content').notNull()",
			"contentSanitized: text('content_sanitized')",
			"embedding: halfvec('embedding')",
		],
	},
	{
		category: 'Knowledge graph derived fields',
		path: 'packages/db/src/schema/knowledge.ts',
		fragments: [
			"name: encryptedText('name').notNull()",
			"displayName: encryptedText('display_name').notNull()",
			"description: encryptedText('description')",
			"embedding: halfvec('embedding')",
		],
	},
	{
		category: 'Calendar event details',
		path: 'packages/db/src/schema/calendar.ts',
		fragments: [
			"accessToken: encryptedText('access_token')",
			"refreshToken: encryptedText('refresh_token')",
			"title: encryptedText('title')",
			"description: encryptedText('description')",
			"location: encryptedText('location')",
			"attendees: encryptedText('attendees')",
		],
	},
	{
		category: 'Audit event metadata',
		path: 'packages/db/src/schema/audit-log.ts',
		fragments: [
			"actorId: text('actor_id').notNull()",
			"metadata: jsonb('metadata').default({}).notNull()",
		],
	},
];

describe('data classification contracts', () => {
	it('keeps sensitive schema categories mapped to protected storage fields', () => {
		for (const contract of schemaContracts) {
			const content = readRoot(contract.path);
			for (const fragment of contract.fragments) {
				expect(content, `${contract.category}: ${fragment}`).toContain(fragment);
			}
		}
	});

	it('documents storage, UI, export, logging, and purge behavior for each sensitive category', () => {
		const docs = readRoot('docs/DATA_CLASSIFICATION.md');
		expect(docs).toContain(
			'| Category | Storage location | Allowed UI surfaces | Allowed export behavior | Logging behavior | Purge behavior |',
		);

		for (const contract of schemaContracts) {
			expect(docs, contract.category).toContain(`| ${contract.category} |`);
		}
	});
});

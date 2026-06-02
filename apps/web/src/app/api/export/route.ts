import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';
import { getAccessibleContacts, getActiveCommitments, listDeals } from '@repo/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

const BASIC_CRM_EXPORT_INCLUDED = ['contacts', 'commitments', 'deals'] as const;
const BASIC_CRM_EXPORT_EXCLUDED = [
	'telegram_messages',
	'chats',
	'knowledge_graph',
	'memories',
	'ai_learning_data',
	'audit_logs',
	'runtime_queues',
] as const;

const BASIC_CRM_EXPORT_FORBIDDEN_KEYS = new Set([
	'auditlogs',
	'chats',
	'embedding',
	'embeddings',
	'encryptedwrk',
	'knowledgegraph',
	'kmscontext',
	'memories',
	'messages',
	'rawmessage',
	'rawmessages',
	'sourceaccountid',
	'telegramaccountid',
	'telegramid',
	'telegrammessages',
	'telegramuserid',
]);

function isForbiddenExportKey(key: string) {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (BASIC_CRM_EXPORT_FORBIDDEN_KEYS.has(normalized)) return true;
	return /^(raw|telegram|source|last)?message(text|content|body|snippet)$/.test(normalized);
}

function stripSensitiveExportFields(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripSensitiveExportFields);
	if (!value || typeof value !== 'object') return value;

	const result: Record<string, unknown> = {};
	for (const [key, childValue] of Object.entries(value)) {
		if (isForbiddenExportKey(key)) continue;
		result[key] = stripSensitiveExportFields(childValue);
	}
	return result;
}

/**
 * GET /api/export — Basic CRM export as JSON.
 * Requires authenticated session with workspace.
 */
export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { allowed, retryAfterMs } = checkRateLimit(`${session.user.id}:export`, 2, 60_000);
	if (!allowed) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
		});
	}

	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
	}

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return NextResponse.json({ error: 'Service unavailable' }, { status: 500 });
	}

	const [contacts, commitments, deals] = await Promise.all([
		getAccessibleContacts(workspaceId, session.user.id, envelope, { limit: 10000 }),
		getActiveCommitments(workspaceId, envelope, { limit: 10000 }),
		listDeals(workspaceId, envelope, { limit: 10000 }),
	]);
	const accessibleContactIds = new Set(contacts.map((contact) => String(contact.id)));

	const exportData = {
		exportType: 'basic_crm',
		schemaVersion: 1,
		description:
			'Basic CRM export containing contacts, active commitments, and deals only. This is not a complete account archive.',
		included: BASIC_CRM_EXPORT_INCLUDED,
		excluded: BASIC_CRM_EXPORT_EXCLUDED,
		exportedAt: new Date().toISOString(),
		contacts: stripSensitiveExportFields(contacts),
		commitments: stripSensitiveExportFields(
			commitments.filter(
				(commitment) =>
					typeof commitment.contactId === 'string' &&
					accessibleContactIds.has(commitment.contactId),
			),
		),
		deals: stripSensitiveExportFields(
			deals.filter((deal) => accessibleContactIds.has(String(deal.contactId))),
		),
	};

	return new NextResponse(JSON.stringify(exportData, null, 2), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="gordian-basic-crm-export-${new Date().toISOString().slice(0, 10)}.json"`,
		},
	});
}

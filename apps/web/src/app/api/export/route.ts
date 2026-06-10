import { auth } from '@/lib/auth';
import {
	BASIC_CRM_EXPORT_EXCLUDED,
	BASIC_CRM_EXPORT_INCLUDED,
	sanitizeBasicCrmExportRows,
} from '@/lib/basic-crm-export-policy';
import { checkRateLimit } from '@/lib/rate-limit';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';
import { getAccessibleContacts, getActiveCommitments, listDeals } from '@repo/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

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
		contacts: sanitizeBasicCrmExportRows('contacts', contacts),
		commitments: sanitizeBasicCrmExportRows(
			'commitments',
			commitments.filter(
				(commitment) =>
					typeof commitment.contactId === 'string' &&
					accessibleContactIds.has(commitment.contactId),
			),
		),
		deals: sanitizeBasicCrmExportRows(
			'deals',
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

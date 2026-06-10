import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { contactHealthFeedback } from '../schema/contact-health-feedback';
import { contacts } from '../schema/contacts';

export const CONTACT_HEALTH_FEEDBACK_ACTIONS = [
	'snooze',
	'mark_low_touch',
	'handled_elsewhere',
	'not_important',
	'dismiss_wrong',
] as const;

export type ContactHealthFeedbackAction = (typeof CONTACT_HEALTH_FEEDBACK_ACTIONS)[number];

export const CONTACT_HEALTH_FEEDBACK_REASONS = [
	'snoozed',
	'normal_low_touch',
	'talked_elsewhere',
	'not_important',
	'wrong_alert',
] as const;

export type ContactHealthFeedbackReason = (typeof CONTACT_HEALTH_FEEDBACK_REASONS)[number];

export interface RecordContactHealthFeedbackInput {
	action: ContactHealthFeedbackAction;
	contactId: string;
	metadata?: Record<string, unknown>;
	reason: ContactHealthFeedbackReason;
	snoozedUntil?: Date | null;
	statusReasonCode?: string | null;
	userId?: string | null;
}

export type ContactHealthFeedbackRow = typeof contactHealthFeedback.$inferSelect;

const ACTION_SET = new Set<string>(CONTACT_HEALTH_FEEDBACK_ACTIONS);
const REASON_SET = new Set<string>(CONTACT_HEALTH_FEEDBACK_REASONS);

function assertKnownFeedback(input: RecordContactHealthFeedbackInput): void {
	if (!ACTION_SET.has(input.action)) throw new Error('Invalid contact health feedback action');
	if (!REASON_SET.has(input.reason)) throw new Error('Invalid contact health feedback reason');
	if (input.action === 'snooze') {
		if (!input.snoozedUntil || input.snoozedUntil.getTime() <= Date.now()) {
			throw new Error('Snooze must be in the future');
		}
	}
}

export async function recordContactHealthFeedback(
	workspaceId: string,
	input: RecordContactHealthFeedbackInput,
) {
	assertKnownFeedback(input);

	const contact = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(and(eq(contacts.id, input.contactId), eq(contacts.workspaceId, workspaceId)))
		.limit(1);
	if (contact.length === 0) throw new Error('Not found');

	const result = await db
		.insert(contactHealthFeedback)
		.values({
			workspaceId,
			contactId: input.contactId,
			userId: input.userId ?? null,
			action: input.action,
			reason: input.reason,
			statusReasonCode: input.statusReasonCode ?? null,
			snoozedUntil: input.snoozedUntil ?? null,
			metadata: input.metadata ?? {},
		})
		.returning();
	return result[0] ?? null;
}

export async function getActiveContactHealthFeedback(
	workspaceId: string,
	contactIds: string[],
	now = new Date(),
) {
	if (contactIds.length === 0) return [];

	return db
		.select()
		.from(contactHealthFeedback)
		.where(
			and(
				eq(contactHealthFeedback.workspaceId, workspaceId),
				inArray(contactHealthFeedback.contactId, contactIds),
				or(
					sql`${contactHealthFeedback.action} != 'snooze'`,
					gt(contactHealthFeedback.snoozedUntil, now),
				),
			),
		)
		.orderBy(desc(contactHealthFeedback.createdAt));
}

export async function getLatestContactHealthFeedback(workspaceId: string, contactId: string) {
	const result = await db
		.select()
		.from(contactHealthFeedback)
		.where(
			and(
				eq(contactHealthFeedback.workspaceId, workspaceId),
				eq(contactHealthFeedback.contactId, contactId),
			),
		)
		.orderBy(desc(contactHealthFeedback.createdAt))
		.limit(10);
	return result;
}

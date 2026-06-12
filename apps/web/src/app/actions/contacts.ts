'use server';

import {
	canAccessContact,
	createContact as dalCreateContact,
	getAccessibleContact as dalGetAccessibleContact,
	getAccessibleContacts as dalGetAccessibleContacts,
	searchContactByEmail as dalSearchByEmail,
	searchContactByName as dalSearchByName,
	searchContactByPhone as dalSearchByPhone,
	updateContact as dalUpdateContact,
} from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';

const emailSchema = z.string().email().max(320);
const optionalTrimmedString = (max: number) => z.string().trim().max(max).optional();
const optionalTrimmedEmail = z
	.string()
	.trim()
	.max(320)
	.refine((value) => value.length === 0 || emailSchema.safeParse(value).success, {
		message: 'Invalid email',
	})
	.optional();
const optionalTrimmedNullableString = (max: number) =>
	z.string().trim().max(max).nullable().optional();
const createContactInputSchema = z
	.object({
		firstName: optionalTrimmedString(200),
		lastName: optionalTrimmedString(200),
		phone: optionalTrimmedString(50),
		email: optionalTrimmedEmail,
		notes: optionalTrimmedString(5000),
		telegramId: optionalTrimmedString(100),
	})
	.refine(contactHasName, {
		message: 'Enter at least a first or last name.',
		path: ['firstName'],
	});

function emptyToUndefined(value: string | undefined): string | undefined {
	return value && value.length > 0 ? value : undefined;
}

function contactHasName(input: { firstName?: string; lastName?: string }): boolean {
	return Boolean(input.firstName || input.lastName);
}

async function filterAccessibleContacts<T extends { id: string }>(
	workspaceId: string,
	userId: string,
	items: T[],
): Promise<T[]> {
	const allowed = await Promise.all(
		items.map((item) => canAccessContact(workspaceId, userId, item.id)),
	);
	return items.filter((_, index) => allowed[index]);
}

export const searchContactsAction = workspaceAction
	.schema(
		z.object({
			query: z.string().trim().min(1).max(200),
			field: z.enum(['name', 'phone', 'email']).default('name'),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { workspaceId, envelope } = ctx;
		if (!envelope) throw new Error('Workspace encryption key not found');

		switch (parsedInput.field) {
			case 'name':
				return filterAccessibleContacts(
					workspaceId,
					ctx.session.user.id,
					await dalSearchByName(workspaceId, parsedInput.query, envelope),
				);
			case 'phone':
				return filterAccessibleContacts(
					workspaceId,
					ctx.session.user.id,
					await dalSearchByPhone(workspaceId, parsedInput.query, envelope),
				);
			case 'email':
				return filterAccessibleContacts(
					workspaceId,
					ctx.session.user.id,
					await dalSearchByEmail(workspaceId, parsedInput.query, envelope),
				);
		}
	});

export const getContactAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		track(ctx.workspaceId, ctx.session.user.id, 'view_contact', {
			contactId: parsedInput.contactId,
		});
		const contact = await dalGetAccessibleContact(
			ctx.workspaceId,
			ctx.session.user.id,
			parsedInput.contactId,
			ctx.envelope,
		);
		if (!contact) throw new Error('Not found');
		return contact;
	});

export const createContactAction = workspaceAction
	.schema(createContactInputSchema)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalCreateContact(
			ctx.workspaceId,
			{
				firstName: emptyToUndefined(parsedInput.firstName),
				lastName: emptyToUndefined(parsedInput.lastName),
				phone: emptyToUndefined(parsedInput.phone),
				email: emptyToUndefined(parsedInput.email),
				notes: emptyToUndefined(parsedInput.notes),
				telegramId: emptyToUndefined(parsedInput.telegramId),
			},
			ctx.envelope,
		);
	});

export const updateContactAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			firstName: optionalTrimmedString(200),
			lastName: optionalTrimmedString(200),
			phone: optionalTrimmedString(50),
			email: optionalTrimmedEmail,
			notes: optionalTrimmedNullableString(5000),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { contactId, ...input } = parsedInput;
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const allowed = await canAccessContact(ctx.workspaceId, ctx.session.user.id, contactId);
		if (!allowed) throw new Error('Not found');
		return dalUpdateContact(
			ctx.workspaceId,
			contactId,
			{
				firstName: emptyToUndefined(input.firstName),
				lastName: emptyToUndefined(input.lastName),
				phone: emptyToUndefined(input.phone),
				email: emptyToUndefined(input.email),
				notes:
					input.notes === null
						? null
						: input.notes === undefined
							? undefined
							: input.notes.length > 0
								? input.notes
								: null,
			},
			ctx.envelope,
		);
	});

export const listContactsAction = workspaceAction
	.schema(
		z.object({
			limit: z.number().int().positive().optional(),
			offset: z.number().int().nonnegative().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalGetAccessibleContacts(ctx.workspaceId, ctx.session.user.id, ctx.envelope, {
			limit: parsedInput.limit,
			offset: parsedInput.offset,
		});
	});

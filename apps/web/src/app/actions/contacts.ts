'use server';

import { workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import {
	createContact as dalCreateContact,
	getContact as dalGetContact,
	listContacts as dalListContacts,
	searchContactByEmail as dalSearchByEmail,
	searchContactByName as dalSearchByName,
	searchContactByPhone as dalSearchByPhone,
	updateContact as dalUpdateContact,
} from '@repo/db';
import { z } from 'zod';

export const searchContactsAction = workspaceAction
	.schema(
		z.object({
			query: z.string().min(1).max(200),
			field: z.enum(['name', 'phone', 'email']).default('name'),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { workspaceId, envelope } = ctx;
		if (!envelope) throw new Error('Workspace encryption key not found');

		switch (parsedInput.field) {
			case 'name':
				return dalSearchByName(workspaceId, parsedInput.query, envelope);
			case 'phone':
				return dalSearchByPhone(workspaceId, parsedInput.query, envelope);
			case 'email':
				return dalSearchByEmail(workspaceId, parsedInput.query, envelope);
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
		return dalGetContact(ctx.workspaceId, parsedInput.contactId, ctx.envelope);
	});

export const createContactAction = workspaceAction
	.schema(
		z.object({
			firstName: z.string().max(200).optional(),
			lastName: z.string().max(200).optional(),
			phone: z.string().max(50).optional(),
			email: z.string().email().max(320).optional(),
			notes: z.string().max(5000).optional(),
			telegramId: z.string().max(100).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalCreateContact(ctx.workspaceId, parsedInput, ctx.envelope);
	});

export const updateContactAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			firstName: z.string().max(200).optional(),
			lastName: z.string().max(200).optional(),
			phone: z.string().max(50).optional(),
			email: z.string().email().max(320).optional(),
			notes: z.string().max(5000).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { contactId, ...input } = parsedInput;
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalUpdateContact(ctx.workspaceId, contactId, input, ctx.envelope);
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
		return dalListContacts(ctx.workspaceId, ctx.envelope, {
			limit: parsedInput.limit,
			offset: parsedInput.offset,
		});
	});

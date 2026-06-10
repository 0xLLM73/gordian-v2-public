import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireSession = vi.fn();
const mockGetUserWorkspaceId = vi.fn();
const mockGetWorkspaceEnvelope = vi.fn();
const mockNotFound = vi.fn(() => {
	throw new Error('NEXT_NOT_FOUND');
});
const mockGetAccessibleContact = vi.fn();
const mockGetMessagesByContact = vi.fn();

vi.stubGlobal('React', React);

vi.mock('next/navigation', () => ({
	notFound: mockNotFound,
}));

vi.mock('next/link', () => ({
	default: 'a',
}));

vi.mock('@/components/chat/chat-context-setter', () => ({
	ChatContextSetter: () => React.createElement('div'),
}));
vi.mock('@/components/contact-health-feedback-actions', () => ({
	ContactHealthFeedbackActions: () => React.createElement('div'),
}));
vi.mock('@/components/contact-tag-editor', () => ({
	ContactTagEditor: () => React.createElement('div'),
}));
vi.mock('@/components/contacts/contact-detail-shell', () => ({
	ContactDetailShell: ({ overviewContent }: { overviewContent: React.ReactNode }) =>
		React.createElement('div', null, overviewContent),
}));
vi.mock('@/components/contacts/contact-summary-panel', () => ({
	ContactSummaryPanel: () => React.createElement('div'),
}));
vi.mock('@/components/drafts/draft-composer', () => ({
	DraftComposer: () => React.createElement('div'),
}));
vi.mock('@/components/contact-notes', () => ({ ContactNotes: () => React.createElement('div') }));

vi.mock('@/lib/workspace', () => ({
	requireSession: (...args: unknown[]) => mockRequireSession(...args),
	getUserWorkspaceId: (...args: unknown[]) => mockGetUserWorkspaceId(...args),
	getWorkspaceEnvelope: (...args: unknown[]) => mockGetWorkspaceEnvelope(...args),
}));

vi.mock('@/app/actions/knowledge', () => ({
	getContactDecisionsAction: vi.fn(() => Promise.resolve({ data: [] })),
}));

vi.mock('@repo/db', () => ({
	getAccessibleContact: (...args: unknown[]) => mockGetAccessibleContact(...args),
	getCommitmentsByContact: vi.fn(() => Promise.resolve([])),
	getContactTag: vi.fn(() => Promise.resolve(null)),
	getHealthScore: vi.fn(() => Promise.resolve(null)),
	getInvestorProfile: vi.fn(() => Promise.resolve(null)),
	getLatestSummary: vi.fn(() => Promise.resolve(null)),
	getMemoriesByContact: vi.fn(() => Promise.resolve([])),
	getMessageCount: vi.fn(() => Promise.resolve(0)),
	getMessagesByContact: (...args: unknown[]) => mockGetMessagesByContact(...args),
	listKnowledgeByContact: vi.fn(() => Promise.resolve([])),
	listOutcomes: vi.fn(() => Promise.resolve([])),
	getDealsByContact: vi.fn(() => Promise.resolve([])),
	listGoals: vi.fn(() => Promise.resolve([])),
	getIntroductionsByContact: vi.fn(() => Promise.resolve([])),
	getContactsByIds: vi.fn(() => Promise.resolve([])),
	getConnectionsByContact: vi.fn(() => Promise.resolve([])),
}));

describe('contact detail page authorization', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireSession.mockResolvedValue({ user: { id: 'user-1' } });
		mockGetUserWorkspaceId.mockResolvedValue('ws-1');
		mockGetWorkspaceEnvelope.mockResolvedValue({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: {},
			wrkVersion: 1,
		});
		mockGetMessagesByContact.mockResolvedValue([]);
	});

	it('loads contacts through the account-scoped accessible contact helper', async () => {
		mockGetAccessibleContact.mockResolvedValue({
			id: '550e8400-e29b-41d4-a716-446655440001',
			firstName: 'Alice',
			lastName: 'Investor',
		});
		const { default: ContactDetailPage } = await import('@/app/(dashboard)/contacts/[id]/page');

		await ContactDetailPage({
			params: Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440001' }),
		});

		expect(mockGetAccessibleContact).toHaveBeenCalledWith(
			'ws-1',
			'user-1',
			'550e8400-e29b-41d4-a716-446655440001',
			expect.any(Object),
		);
	});

	it('does not load contact messages when the contact is inaccessible', async () => {
		mockGetAccessibleContact.mockResolvedValue(null);
		const { default: ContactDetailPage } = await import('@/app/(dashboard)/contacts/[id]/page');

		await expect(
			ContactDetailPage({
				params: Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440001' }),
			}),
		).rejects.toThrow('NEXT_NOT_FOUND');

		expect(mockGetMessagesByContact).not.toHaveBeenCalled();
	});

	it('renders a stable Telegram contact label instead of the raw Telegram ID', async () => {
		mockGetAccessibleContact.mockResolvedValue({
			id: '550e8400-e29b-41d4-a716-446655440001',
			firstName: 'Alice',
			lastName: 'Investor',
			telegramId: '100001',
			phone: null,
			email: null,
			notes: null,
		});
		const { default: ContactDetailPage } = await import('@/app/(dashboard)/contacts/[id]/page');

		const element = await ContactDetailPage({
			params: Promise.resolve({ id: '550e8400-e29b-41d4-a716-446655440001' }),
		});
		const html = renderToStaticMarkup(element as React.ReactElement);

		expect(html).toContain('Telegram contact');
		expect(html).toContain('Linked Telegram contact');
		expect(html).not.toContain('100001');
		expect(html).not.toContain('Telegram ID');
	});
});

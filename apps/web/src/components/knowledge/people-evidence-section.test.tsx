import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
	PeopleEvidenceSection,
	type TopicEvidenceContact,
	claimLabelForEvidenceKind,
} from './people-evidence-section';

describe('PeopleEvidenceSection', () => {
	it('renders people, evidence snippets, confidence, counts, timestamps, and labels', () => {
		const contacts: TopicEvidenceContact[] = [
			{
				id: 'contact-1',
				firstName: 'Alice',
				lastName: 'Smith',
				relationType: 'works_on',
				strength: 0.91,
				evidenceCount: 2,
				lastEvidenceAt: new Date('2026-05-01T12:00:00Z'),
				evidence: [
					{
						id: 'evidence-1',
						messageId: 'message-1',
						evidenceKind: 'llm_extracted',
						confidence: 0.93,
						snippet: 'Alice said the Solana validator launch is her main project.',
						occurredAt: new Date('2026-05-01T12:00:00Z'),
						createdAt: new Date('2026-05-01T12:05:00Z'),
					},
					{
						id: 'evidence-2',
						messageId: 'message-2',
						evidenceKind: 'embedding_match',
						confidence: 0.81,
						snippet: 'We talked more about Solana infra and validators.',
						occurredAt: new Date('2026-05-02T12:00:00Z'),
						createdAt: new Date('2026-05-02T12:05:00Z'),
					},
				],
			},
		];

		render(React.createElement(PeopleEvidenceSection, { contacts }));

		expect(screen.getByRole('heading', { name: 'People and evidence' })).toBeTruthy();
		expect(screen.getByText('Alice Smith')).toBeTruthy();
		expect(screen.getByText('works on')).toBeTruthy();
		expect(screen.getAllByText('93% confidence')).toHaveLength(2);
		expect(screen.getByText('2 evidence observations')).toBeTruthy();
		expect(
			screen.getByText('Alice said the Solana validator launch is her main project.'),
		).toBeTruthy();
		expect(screen.getByText('We talked more about Solana infra and validators.')).toBeTruthy();
		expect(screen.getAllByText('explicit')[0]).toBeTruthy();
		expect(screen.getByText('inferred')).toBeTruthy();
	});

	it('renders the legacy/no-evidence state for aggregate-only contact links', () => {
		const contacts: TopicEvidenceContact[] = [
			{
				id: 'contact-legacy',
				firstName: 'Bob',
				lastName: 'Jones',
				relationType: 'knows_about',
				strength: 0.7,
				evidenceCount: 3,
				lastEvidenceAt: new Date('2026-04-01T00:00:00Z'),
				evidence: [],
			},
		];

		render(React.createElement(PeopleEvidenceSection, { contacts }));

		const row = screen.getByText('Bob Jones').closest('li');
		expect(row).toBeTruthy();
		expect(within(row as HTMLElement).getByText('legacy/no evidence')).toBeTruthy();
		expect(
			within(row as HTMLElement).getByText(
				/This connection exists, but no source message evidence has been stored yet/,
			),
		).toBeTruthy();
	});

	it('maps evidence kinds to simple claim labels', () => {
		expect(claimLabelForEvidenceKind('llm_extracted')).toBe('explicit');
		expect(claimLabelForEvidenceKind('embedding_match')).toBe('inferred');
		expect(claimLabelForEvidenceKind('contact_cooccurrence')).toBe('inferred');
		expect(claimLabelForEvidenceKind('inferred_weak')).toBe('weak inferred');
		expect(claimLabelForEvidenceKind('manual')).toBe('manual');
		expect(claimLabelForEvidenceKind(undefined)).toBe('legacy/no evidence');
	});
});

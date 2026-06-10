import { getContactInitial } from '@/lib/contact-initial';
import { formatRelativeDate } from '@/lib/format';
import {
	classifyKnowledgeEvidenceQuality,
	evidenceSupportsKnowledgeTopic,
	sourceMessageSelectionMethod,
} from '@repo/shared';
import Link from 'next/link';
import React from 'react';

export interface TopicEvidenceItem {
	id: string;
	messageId?: string | null;
	evidenceKind?: string | null;
	confidence?: number | null;
	snippet?: string | null;
	occurredAt?: Date | null;
	createdAt?: Date | null;
	metadata?: Record<string, unknown> | null;
}

export interface TopicEvidenceContact {
	id: string;
	firstName?: string | null;
	lastName?: string | null;
	relationType: string;
	strength?: number | null;
	evidenceCount: number;
	lastEvidenceAt?: Date | null;
	evidence: TopicEvidenceItem[];
}

export function evidenceSupportsTopic(
	evidence: TopicEvidenceItem,
	topicTerms: string[] = [],
): boolean {
	if (topicTerms.length === 0) return true;
	return evidenceSupportsKnowledgeTopic(evidence, topicTerms);
}

export function claimLabelForEvidenceKind(evidenceKind?: string | null): string {
	switch (evidenceKind) {
		case 'llm_extracted':
			return 'explicit';
		case 'embedding_match':
		case 'contact_cooccurrence':
			return 'inferred';
		case 'inferred_weak':
			return 'weak inferred';
		case 'manual':
			return 'manual';
		default:
			return 'legacy/no evidence';
	}
}

function formatPercent(value?: number | null): string {
	if (typeof value !== 'number' || Number.isNaN(value)) return 'unknown confidence';
	return `${Math.round(value * 100)}% confidence`;
}

function displayName(contact: Pick<TopicEvidenceContact, 'firstName' | 'lastName'>): string {
	return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown contact';
}

function latestTimestamp(contact: TopicEvidenceContact): Date | null {
	return contact.evidence[0]?.occurredAt ?? contact.lastEvidenceAt ?? null;
}

function evidenceQualityLabel(evidence: TopicEvidenceItem, topicTerms: string[]): string {
	const result = classifyKnowledgeEvidenceQuality(evidence, topicTerms);
	switch (result.quality) {
		case 'direct_source':
			return 'direct source';
		case 'possible_connection':
			return 'possible connection';
		case 'weak_or_stale':
			return 'weak/stale';
	}
}

function partitionContactsByEvidenceQuality(
	contacts: TopicEvidenceContact[],
	topicTerms: string[],
) {
	const directContacts: TopicEvidenceContact[] = [];
	const possibleContacts: TopicEvidenceContact[] = [];

	for (const contact of contacts) {
		const directEvidence: TopicEvidenceItem[] = [];
		const possibleEvidence: TopicEvidenceItem[] = [];

		for (const evidence of contact.evidence) {
			const quality = classifyKnowledgeEvidenceQuality(evidence, topicTerms).quality;
			if (topicTerms.length === 0 || quality === 'direct_source') {
				directEvidence.push(evidence);
			} else {
				possibleEvidence.push(evidence);
			}
		}

		if (directEvidence.length > 0) {
			directContacts.push({
				...contact,
				evidence: directEvidence,
				evidenceCount: directEvidence.length,
			});
		}
		if (possibleEvidence.length > 0) {
			possibleContacts.push({
				...contact,
				evidence: possibleEvidence,
				evidenceCount: possibleEvidence.length,
			});
		}
	}

	return { directContacts, possibleContacts };
}

function EvidenceContactList({
	contacts,
	topicTerms,
}: {
	contacts: TopicEvidenceContact[];
	topicTerms: string[];
}) {
	return (
		<ul className="divide-y divide-gray-100">
			{contacts.map((contact) => {
				const name = displayName(contact);
				const initials = getContactInitial(contact.firstName, contact.lastName, name);
				const latestEvidence = contact.evidence[0];
				const claimLabel = claimLabelForEvidenceKind(latestEvidence?.evidenceKind);
				const confidence = latestEvidence?.confidence ?? contact.strength;
				const lastMentioned = latestTimestamp(contact);

				return (
					<li key={contact.id} className="py-4">
						<div className="flex gap-3">
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
								{initials}
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<Link
										href={`/contacts/${contact.id}`}
										className="text-sm font-medium text-foreground transition-colors hover:text-indigo-700"
									>
										{name}
									</Link>
									<span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
										{contact.relationType.replace(/_/g, ' ')}
									</span>
									<span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
										{claimLabel}
									</span>
									<span className="text-xs text-muted-foreground">{formatPercent(confidence)}</span>
								</div>

								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<span>
										{contact.evidenceCount} evidence observation
										{contact.evidenceCount === 1 ? '' : 's'}
									</span>
									{lastMentioned ? (
										<span>Last mentioned {formatRelativeDate(lastMentioned)}</span>
									) : (
										<span>Last mentioned date unavailable</span>
									)}
								</div>

								{contact.evidence.length > 0 ? (
									<ul className="mt-3 space-y-2">
										{contact.evidence.slice(0, 3).map((evidence) => {
											const selectionMethod = sourceMessageSelectionMethod(evidence);
											return (
												<li
													key={evidence.id}
													className="rounded-md border border-border bg-background p-3"
												>
													<div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
														<span>{evidenceQualityLabel(evidence, topicTerms)}</span>
														<span>{claimLabelForEvidenceKind(evidence.evidenceKind)}</span>
														{evidence.evidenceKind ? (
															<span>{evidence.evidenceKind.replace(/_/g, ' ')}</span>
														) : null}
														{selectionMethod ? (
															<span>{selectionMethod.replace(/_/g, ' ')}</span>
														) : null}
														{typeof evidence.confidence === 'number' ? (
															<span>{formatPercent(evidence.confidence)}</span>
														) : null}
														{evidence.occurredAt ? (
															<span>{formatRelativeDate(evidence.occurredAt)}</span>
														) : (
															<span>Message timestamp unavailable</span>
														)}
													</div>
													<p className="line-clamp-3 text-sm text-foreground">
														{evidence.snippet ?? 'Evidence captured without a snippet.'}
													</p>
												</li>
											);
										})}
									</ul>
								) : (
									<p className="mt-3 rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
										This connection exists, but no source message evidence has been stored yet. It
										may be from legacy extraction or an older graph version.
									</p>
								)}
							</div>
						</div>
					</li>
				);
			})}
		</ul>
	);
}

export function PeopleEvidenceSection({
	contacts,
	topicTerms = [],
}: {
	contacts: TopicEvidenceContact[];
	topicTerms?: string[];
}) {
	void React;
	const normalizedTopicTerms = Array.from(
		new Set(topicTerms.map((term) => term.trim()).filter(Boolean)),
	);
	const { directContacts, possibleContacts } = partitionContactsByEvidenceQuality(
		contacts,
		normalizedTopicTerms,
	);
	const displayContacts = normalizedTopicTerms.length === 0 ? contacts : directContacts;

	return (
		<section className="rounded-lg border border-border bg-card p-6">
			<div className="mb-4">
				<h2 className="text-lg font-semibold text-foreground">People and evidence</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Contacts connected to this topic, with direct source messages for each claim.
				</p>
			</div>

			{displayContacts.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No direct source-message evidence is available for this topic yet.
				</p>
			) : (
				<EvidenceContactList contacts={displayContacts} topicTerms={normalizedTopicTerms} />
			)}

			{normalizedTopicTerms.length > 0 && possibleContacts.length > 0 ? (
				<div className="mt-5 border-t border-border pt-4">
					<div className="mb-2 flex flex-wrap items-center gap-2">
						<h3 className="text-sm font-semibold text-foreground">Possible connections</h3>
						<span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
							{possibleContacts.reduce((sum, contact) => sum + contact.evidence.length, 0)} needs
							review
						</span>
					</div>
					<p className="text-xs text-muted-foreground">
						These rows are retained for review, but they do not directly mention this topic in the
						stored source snippet.
					</p>
					<EvidenceContactList contacts={possibleContacts} topicTerms={normalizedTopicTerms} />
				</div>
			) : null}
		</section>
	);
}

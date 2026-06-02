import { formatRelativeDate } from '@/lib/format';
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

export function PeopleEvidenceSection({ contacts }: { contacts: TopicEvidenceContact[] }) {
	void React;
	return (
		<section className="rounded-lg border border-border bg-card p-6">
			<div className="mb-4">
				<h2 className="text-lg font-semibold text-foreground">People and evidence</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Contacts connected to this topic, with the messages that support each claim.
				</p>
			</div>

			{contacts.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No contacts linked yet. Sync messages to discover connections.
				</p>
			) : (
				<ul className="divide-y divide-gray-100">
					{contacts.map((contact) => {
						const name = displayName(contact);
						const initials = (contact.firstName || name || '?')[0].toUpperCase();
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
											<span className="text-xs text-muted-foreground">
												{formatPercent(confidence)}
											</span>
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
												{contact.evidence.slice(0, 3).map((evidence) => (
													<li
														key={evidence.id}
														className="rounded-md border border-border bg-background p-3"
													>
														<div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
															<span>{claimLabelForEvidenceKind(evidence.evidenceKind)}</span>
															{evidence.evidenceKind ? (
																<span>{evidence.evidenceKind.replace(/_/g, ' ')}</span>
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
												))}
											</ul>
										) : (
											<p className="mt-3 rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
												This connection exists, but no source message evidence has been stored yet.
												It may be from legacy extraction or an older graph version.
											</p>
										)}
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

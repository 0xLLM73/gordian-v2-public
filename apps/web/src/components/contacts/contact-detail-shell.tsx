'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ContactTabs } from './contact-tabs';
import { MessageHistory } from './message-history';

type Tab =
	| 'overview'
	| 'messages'
	| 'commitments'
	| 'knowledge'
	| 'decisions'
	| 'investor'
	| 'history';

interface Props {
	contactId: string;
	overviewContent: ReactNode;
	commitmentsContent: ReactNode;
	knowledgeContent: ReactNode;
	decisionsContent: ReactNode;
	investorContent: ReactNode;
	historyContent: ReactNode;
	messageBadge?: number;
	commitmentBadge?: number;
}

export function ContactDetailShell({
	contactId,
	overviewContent,
	commitmentsContent,
	knowledgeContent,
	decisionsContent,
	investorContent,
	historyContent,
	messageBadge,
	commitmentBadge,
}: Props) {
	const [activeTab, setActiveTab] = useState<Tab>('overview');

	return (
		<div>
			<ContactTabs
				activeTab={activeTab}
				onTabChange={setActiveTab}
				messageBadge={messageBadge}
				commitmentBadge={commitmentBadge}
			/>
			<div className="mt-6">
				{activeTab === 'overview' ? overviewContent : null}
				{activeTab === 'messages' ? <MessageHistory contactId={contactId} /> : null}
				{activeTab === 'commitments' ? commitmentsContent : null}
				{activeTab === 'knowledge' ? knowledgeContent : null}
				{activeTab === 'decisions' ? decisionsContent : null}
				{activeTab === 'investor' ? investorContent : null}
				{activeTab === 'history' ? historyContent : null}
			</div>
		</div>
	);
}

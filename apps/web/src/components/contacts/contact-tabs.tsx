'use client';

export type Tab =
	| 'overview'
	| 'messages'
	| 'commitments'
	| 'knowledge'
	| 'decisions'
	| 'investor'
	| 'history';

interface Props {
	activeTab: Tab;
	onTabChange: (tab: Tab) => void;
	messageBadge?: number;
	commitmentBadge?: number;
}

const TABS: Array<{ id: Tab; label: string }> = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'messages', label: 'Messages' },
	{ id: 'commitments', label: 'Commitments' },
	{ id: 'knowledge', label: 'Knowledge' },
	{ id: 'decisions', label: 'Decisions' },
	{ id: 'investor', label: 'Investor' },
	{ id: 'history', label: 'History' },
];

export function ContactTabs({ activeTab, onTabChange, messageBadge, commitmentBadge }: Props) {
	return (
		<div className="border-b border-border">
			<nav className="-mb-px flex gap-6">
				{TABS.map((tab) => {
					const isActive = activeTab === tab.id;
					const badge =
						tab.id === 'messages'
							? messageBadge
							: tab.id === 'commitments'
								? commitmentBadge
								: undefined;

					return (
						<button
							key={tab.id}
							type="button"
							onClick={() => onTabChange(tab.id)}
							className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
								isActive
									? 'border-primary text-primary'
									: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
							}`}
						>
							{tab.label}
							{badge !== undefined && badge > 0 ? (
								<span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
									{badge}
								</span>
							) : null}
						</button>
					);
				})}
			</nav>
		</div>
	);
}

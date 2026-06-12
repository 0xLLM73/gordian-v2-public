'use client';

import { Columns3, List } from 'lucide-react';
import { Children, useState } from 'react';

export function DealsViewToggle({
	listView,
	kanbanView,
}: {
	listView: React.ReactNode;
	kanbanView: React.ReactNode;
}) {
	const [view, setView] = useState<'list' | 'kanban'>('list');
	const activeView = view === 'list' ? listView : kanbanView;

	return (
		<div>
			<div className="mb-4 flex w-fit gap-1 rounded-lg border border-border p-0.5">
				<button
					type="button"
					aria-pressed={view === 'list'}
					onClick={() => setView('list')}
					className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
						view === 'list'
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<List className="h-3.5 w-3.5" aria-hidden="true" />
					List
				</button>
				<button
					type="button"
					aria-pressed={view === 'kanban'}
					onClick={() => setView('kanban')}
					className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
						view === 'kanban'
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					<Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
					Board
				</button>
			</div>
			<div data-testid={`deals-${view}-view`}>{Children.toArray(activeView)}</div>
		</div>
	);
}
